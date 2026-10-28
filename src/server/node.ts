/**
 * Servidor Node: API + interfaz compilada, base SQLite en archivo.
 * Escucha en toda la red local para poder entrar desde el celular.
 *
 *   npm run server            (usa data/sdc.db, carga la demo si está vacía)
 *   PORT=9000 DB_PATH=... npm run server
 *
 * Para usarlo de verdad (sin datos de ejemplo), el primer arranque crea el administrador:
 *   DEMO=0 ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_NAME=... COMPANY_NAME=... WAREHOUSE_NAME=...] npm run server
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import { createApp } from './api/app'
import { bootstrap } from './bootstrap'
import { NodeSqliteDb } from './db/nodeSqlite'
import { migrate } from './db/schema'
import { seed } from './seed'

const env = process.env
const PORT = Number(env.PORT ?? 8787)
const DB_PATH = env.DB_PATH ?? 'data/sdc.db'
const DEMO = env.DEMO !== '0'

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new NodeSqliteDb(DB_PATH)
migrate(db)
if (DEMO) {
  if (await seed(db)) console.log('Base nueva: se cargaron los datos de demostración.')
} else if (!db.get('SELECT id FROM users LIMIT 1')) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.error('La base está vacía: para el primer arranque sin demo indicá ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres).')
    process.exit(1)
  }
  try {
    await bootstrap(db, {
      adminName: env.ADMIN_NAME ?? 'Administrador', adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD,
      companyName: env.COMPANY_NAME, warehouseName: env.WAREHOUSE_NAME,
      warehouseLength: env.WAREHOUSE_LENGTH_MM ? Number(env.WAREHOUSE_LENGTH_MM) : undefined,
      warehouseWidth: env.WAREHOUSE_WIDTH_MM ? Number(env.WAREHOUSE_WIDTH_MM) : undefined,
    })
  } catch (err) {
    console.error(`No se pudo crear el administrador: ${(err as Error).message}`)
    process.exit(1)
  }
  console.log(`Base nueva: se creó el administrador ${env.ADMIN_EMAIL}. Entrá con ese usuario para cargar el resto.`)
}

// la interfaz compilada para hablar con este servidor (npm run build:server)
const UI_DIR = './dist-server'
if (!existsSync(`${UI_DIR}/index.html`)) console.warn('Falta compilar la interfaz: usá "npm run server" (compila y arranca) o "npm run build:server".')

const root = new Hono()
root.route('/', createApp({ db, demo: DEMO }))
root.use('/*', serveStatic({ root: UI_DIR }))

serve({ fetch: root.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => `http://${n!.address}:${PORT}`)
  console.log(`\nSistemas de Carga · Gestión — servidor listo`)
  console.log(`  En esta computadora: http://localhost:${PORT}`)
  for (const url of lan) console.log(`  Desde el celular (misma red Wi-Fi): ${url}`)
  console.log(`  Base de datos: ${DB_PATH}\n`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { db.close(); process.exit(0) })
