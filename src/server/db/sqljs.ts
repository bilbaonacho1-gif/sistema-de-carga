/** Motor del navegador: SQLite compilado a WebAssembly (sql.js). */
import type { Database } from 'sql.js'
import { BaseDb, type Row, type RunResult, type SqlValue } from './db'

const prefixed = (params: SqlValue[] | Record<string, SqlValue>) =>
  Array.isArray(params) ? params : Object.fromEntries(Object.entries(params).map(([k, v]) => [`:${k}`, v]))

export class SqlJsDb extends BaseDb {
  constructor(public readonly raw: Database) {
    super()
    this.raw.exec('PRAGMA foreign_keys = ON')
  }

  protected allRaw(sql: string, params: SqlValue[] | Record<string, SqlValue>): Row[] {
    const st = this.raw.prepare(sql)
    try {
      st.bind(prefixed(params))
      const rows: Row[] = []
      while (st.step()) rows.push(st.getAsObject() as Row)
      return rows
    } finally {
      st.free()
    }
  }

  protected runRaw(sql: string, params: SqlValue[] | Record<string, SqlValue>): RunResult {
    const st = this.raw.prepare(sql)
    try {
      st.run(prefixed(params))
    } finally {
      st.free()
    }
    const changes = this.raw.getRowsModified()
    const id = this.raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0]
    return { changes, lastInsertRowid: Number(id ?? 0) }
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  /** Copia completa de la base (para guardarla en el navegador). */
  export(): Uint8Array {
    const data = this.raw.export()
    // export() reabre la base y los PRAGMA vuelven a su valor por defecto
    this.raw.exec('PRAGMA foreign_keys = ON')
    return data
  }
}
