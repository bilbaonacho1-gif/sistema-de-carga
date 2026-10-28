/**
 * Acceso a la base de datos SQLite, igual en los dos motores:
 *  - node:sqlite (servidor Node, archivo en disco)
 *  - sql.js (SQLite compilado a WebAssembly, corre dentro del navegador)
 *
 * Las consultas usan parámetros con nombre ":nombre". Los servicios sólo ven esta interfaz.
 */
export type SqlValue = string | number | null
export type Params = Record<string, unknown> | unknown[]
export type Row = Record<string, SqlValue>

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface Db {
  all<T = Row>(sql: string, params?: Params): T[]
  get<T = Row>(sql: string, params?: Params): T | undefined
  run(sql: string, params?: Params): RunResult
  exec(sql: string): void
  /** Ejecuta `fn` en una transacción (anidable). Si algo falla, no queda nada a medias. */
  transaction<T>(fn: () => T): T
  /** Avisa cada vez que se confirma una transacción de escritura. */
  onCommit(listener: () => void): void
}

const toSql = (v: unknown): SqlValue => {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  return JSON.stringify(v)
}

const NAME_RE = /(?<![:\w]):([A-Za-z_]\w*)/g

export abstract class BaseDb implements Db {
  private depth = 0
  private listeners: (() => void)[] = []
  private names = new Map<string, string[]>()

  protected abstract allRaw(sql: string, params: SqlValue[] | Record<string, SqlValue>): Row[]
  protected abstract runRaw(sql: string, params: SqlValue[] | Record<string, SqlValue>): RunResult
  abstract exec(sql: string): void

  /** Deja sólo los parámetros que la consulta usa, convertidos a valores de SQLite. */
  protected normalize(sql: string, params?: Params): SqlValue[] | Record<string, SqlValue> {
    if (!params) return []
    if (Array.isArray(params)) return params.map(toSql)
    let names = this.names.get(sql)
    if (!names) {
      names = [...new Set([...sql.matchAll(NAME_RE)].map((m) => m[1]))]
      this.names.set(sql, names)
    }
    const out: Record<string, SqlValue> = {}
    for (const n of names) out[n] = toSql((params as Record<string, unknown>)[n])
    return out
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    return this.allRaw(sql, this.normalize(sql, params)) as T[]
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  run(sql: string, params?: Params): RunResult {
    const result = this.runRaw(sql, this.normalize(sql, params))
    // fuera de una transacción cada escritura se confirma sola (por ejemplo, abrir sesión)
    if (this.depth === 0 && result.changes > 0) this.committed()
    return result
  }

  transaction<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`
    this.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
    this.depth++
    try {
      const result = fn()
      this.depth--
      if (this.depth === 0) {
        this.exec('COMMIT')
        this.committed()
      } else {
        this.exec(`RELEASE ${sp}`)
      }
      return result
    } catch (err) {
      this.depth--
      this.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw err
    }
  }

  onCommit(listener: () => void): void {
    this.listeners.push(listener)
  }

  private committed(): void {
    for (const l of this.listeners) l()
  }
}
