/**
 * Primer arranque SIN datos de demostración: crea la empresa, el almacén con sus zonas de
 * recepción y despacho, y el primer administrador. Todo lo demás (usuarios, productos,
 * racks desde el Diseñador 3D) se carga después desde la app.
 */
import type { Db } from './db/db'
import { hashPassword } from './core/auth'
import { invalid, systemClock, type Ctx } from './core/context'
import { actorFor } from './core/roles'
import { createZone } from './core/warehouse'

export interface InitialSetup {
  adminName: string
  adminEmail: string
  adminPassword: string
  companyName?: string
  warehouseName?: string
  /** Medidas del almacén en mm (por defecto 32 × 22 m). */
  warehouseLength?: number
  warehouseWidth?: number
}

const ZONE = { w: 6500, h: 3600, margin: 1000, top: 800 }

/** Devuelve false si la base ya tenía usuarios (no toca nada). */
export async function bootstrap(db: Db, s: InitialSetup): Promise<boolean> {
  if (db.get('SELECT id FROM users LIMIT 1')) return false
  const email = s.adminEmail.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid(`"${s.adminEmail}" no es un email válido.`)
  const length = s.warehouseLength ?? 32_000
  const width = s.warehouseWidth ?? 22_000
  if (length < 2 * (ZONE.w + ZONE.margin) + 2000 || width < 10_000) throw invalid('El almacén tiene que medir al menos 17 × 10 m.')
  const hash = await hashPassword(s.adminPassword)
  const now = systemClock.now()

  db.transaction(() => {
    const { lastInsertRowid: companyId } = db.run(
      "INSERT INTO companies (name, kind, sectors, created_at) VALUES (:name, 'interna', :sectors, :now)",
      { name: s.companyName?.trim() || 'Sistemas de Carga S.A.', sectors: JSON.stringify(['Administración', 'Almacén', 'Producción', 'Despacho']), now },
    )
    const { lastInsertRowid: adminId } = db.run(
      `INSERT INTO users (company_id, name, email, password_hash, role, sector, active, created_at)
       VALUES (:companyId, :name, :email, :hash, 'admin', 'Administración', 1, :now)`,
      { companyId, name: s.adminName.trim() || 'Administrador', email, hash, now },
    )
    const { lastInsertRowid: warehouseId } = db.run(
      "INSERT INTO warehouses (name, address, length_mm, width_mm, created_at) VALUES (:name, '', :length, :width, :now)",
      { name: s.warehouseName?.trim() || 'Almacén principal', length, width, now },
    )
    const ctx: Ctx = { db, clock: systemClock, actor: actorFor(db, { id: adminId, name: s.adminName, role: 'admin', companyId }) }
    createZone(ctx, { warehouseId, code: 'REC', name: 'Recepción', x: ZONE.margin, y: ZONE.top, w: ZONE.w, h: ZONE.h })
    createZone(ctx, { warehouseId, code: 'DES', name: 'Despacho', x: length - ZONE.margin - ZONE.w, y: ZONE.top, w: ZONE.w, h: ZONE.h })
  })
  return true
}
