/** Motor del servidor Node: SQLite nativo de Node (node:sqlite), archivo en disco. */
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { BaseDb, type Row, type RunResult, type SqlValue } from './db'

export class NodeSqliteDb extends BaseDb {
  private raw: DatabaseSync
  private statements = new Map<string, StatementSync>()

  constructor(path: string) {
    super()
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA foreign_keys = ON')
    if (path !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL')
  }

  private prepare(sql: string): StatementSync {
    let s = this.statements.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.statements.set(sql, s)
    }
    return s
  }

  protected allRaw(sql: string, params: SqlValue[] | Record<string, SqlValue>): Row[] {
    const s = this.prepare(sql)
    return (Array.isArray(params) ? s.all(...params) : s.all(params)) as Row[]
  }

  protected runRaw(sql: string, params: SqlValue[] | Record<string, SqlValue>): RunResult {
    const s = this.prepare(sql)
    const r = Array.isArray(params) ? s.run(...params) : s.run(params)
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  close(): void {
    this.raw.close()
  }
}
