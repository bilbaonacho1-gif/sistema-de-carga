/**
 * Servidor dentro del navegador: la misma API y la misma base SQLite (compilada a
 * WebAssembly). Se guarda en IndexedDB después de cada operación, así que los datos
 * sobreviven al recargar. Es lo que permite la demo en un único archivo .html.
 */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { createApp } from './api/app'
import { SqlJsDb } from './db/sqljs'
import { migrate } from './db/schema'
import { seed } from './seed'

const IDB_NAME = 'sdc-gestion'
const IDB_STORE = 'kv'
const IDB_KEY = 'database'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await openIdb()
    try {
      // se espera a que la transacción termine: recién ahí lo escrito quedó guardado
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, mode)
        const req = fn(tx.objectStore(IDB_STORE))
        tx.oncomplete = () => resolve(req.result as T)
        tx.onerror = tx.onabort = () => reject(tx.error ?? req.error)
      })
    } finally {
      db.close()
    }
  } catch {
    // modo privado o almacenamiento bloqueado: la app funciona igual, sin guardar
    return undefined
  }
}

export type LocalFetch = (req: Request) => Promise<Response>

let persistEnabled = true

export async function createBrowserServer(): Promise<LocalFetch> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const saved = await idb<Uint8Array>('readonly', (s) => s.get(IDB_KEY))
  let db: SqlJsDb
  try {
    db = new SqlJsDb(saved ? new SQL.Database(saved) : new SQL.Database())
    migrate(db)
  } catch (err) {
    // copia guardada dañada o de otra versión: se empieza de cero
    console.error('No se pudo abrir la base guardada en este navegador; se vuelve a la demo inicial.', err)
    db = new SqlJsDb(new SQL.Database())
    migrate(db)
  }
  const fresh = await seed(db)

  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  const save = () => {
    dirty = false
    return persistEnabled ? idb('readwrite', (s) => s.put(db.export(), IDB_KEY)) : Promise.resolve(undefined)
  }
  const scheduleSave = () => {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(save, 300)
  }
  db.onCommit(scheduleSave)
  // al pasar a segundo plano (cambiar de app en el celular, cerrar la pestaña) se guarda en el momento
  const flush = () => {
    if (!dirty) return
    clearTimeout(timer)
    void save()
  }
  addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  if (fresh || !saved) await save()

  const app = createApp({ db, demo: true })
  return (req) => Promise.resolve(app.fetch(req))
}

/** Borra los datos guardados en este navegador (vuelve a la demo inicial al recargar). */
export async function resetBrowserData(): Promise<void> {
  persistEnabled = false
  await idb('readwrite', (s) => s.delete(IDB_KEY))
}
