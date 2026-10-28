/**
 * Esquema de la base de datos y migraciones.
 * Cada migración se aplica una sola vez; la versión queda guardada en `meta`.
 */
import type { Db } from './db'
import { seedRolePermissions } from '../core/roles'

const V1 = /* sql */ `
CREATE TABLE companies (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('interna', 'cliente')),
  sectors     TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'encargado', 'operario', 'cliente')),
  sector         TEXT NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'u',
  min_stock    INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  description  TEXT NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE warehouses (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  length_mm   INTEGER NOT NULL,
  width_mm    INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

-- Toda ubicación donde puede haber stock: posiciones de rack y zonas de piso (recepción, despacho)
CREATE TABLE warehouse_locations (
  id            INTEGER PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  code          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('rack', 'zona')),
  name          TEXT NOT NULL,
  sector        TEXT NOT NULL,
  x_mm INTEGER, y_mm INTEGER, w_mm INTEGER, h_mm INTEGER,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (warehouse_id, code)
);

CREATE TABLE racks (
  id                INTEGER PRIMARY KEY,
  warehouse_id      INTEGER NOT NULL REFERENCES warehouses(id),
  code              TEXT NOT NULL,
  aisle             TEXT NOT NULL,
  number            INTEGER NOT NULL,
  x_mm              INTEGER NOT NULL,
  y_mm              INTEGER NOT NULL,
  facing            INTEGER NOT NULL DEFAULT 1 CHECK (facing IN (1, -1)),
  length_mm         INTEGER NOT NULL,
  depth_mm          INTEGER NOT NULL,
  height_mm         INTEGER NOT NULL,
  modules           INTEGER NOT NULL,
  levels            INTEGER NOT NULL,
  slots_per_module  INTEGER NOT NULL,
  config            TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (warehouse_id, code)
);

CREATE TABLE rack_positions (
  id           INTEGER PRIMARY KEY,
  rack_id      INTEGER NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  location_id  INTEGER NOT NULL UNIQUE REFERENCES warehouse_locations(id),
  module       INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  slot         INTEGER NOT NULL,
  code         TEXT NOT NULL,
  UNIQUE (rack_id, module, level, slot)
);

-- Stock de cada producto en cada ubicación. "reserved" = comprometido en pedidos.
CREATE TABLE inventory (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  location_id  INTEGER NOT NULL REFERENCES warehouse_locations(id),
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved     INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at   TEXT NOT NULL,
  UNIQUE (product_id, location_id),
  CHECK (reserved <= quantity)
);

CREATE TABLE orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL CHECK (type IN ('salida', 'reposicion')),
  status        TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baja', 'normal', 'alta', 'urgente')),
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  sector        TEXT NOT NULL DEFAULT '',
  requester_id  INTEGER NOT NULL REFERENCES users(id),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  assigned_to   INTEGER REFERENCES users(id),
  needed_by     TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  finalized_at  TEXT
);

CREATE TABLE order_items (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  reserved    INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  received    INTEGER NOT NULL DEFAULT 0 CHECK (received >= 0),
  picked      INTEGER NOT NULL DEFAULT 0,
  picked_by   INTEGER REFERENCES users(id),
  picked_at   TEXT,
  notes       TEXT NOT NULL DEFAULT ''
);

-- De qué ubicación sale lo reservado para cada renglón. consumed = 1 cuando ya se entregó.
CREATE TABLE order_allocations (
  id             INTEGER PRIMARY KEY,
  order_item_id  INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  inventory_id   INTEGER NOT NULL REFERENCES inventory(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  consumed       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE order_status_history (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE TABLE comments (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE inventory_counts (
  id            INTEGER PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  sector        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('en_curso', 'confirmado', 'cancelado')),
  started_by    INTEGER NOT NULL REFERENCES users(id),
  started_at    TEXT NOT NULL,
  confirmed_by  INTEGER REFERENCES users(id),
  confirmed_at  TEXT
);

CREATE TABLE inventory_count_lines (
  id           INTEGER PRIMARY KEY,
  count_id     INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  inventory_id INTEGER REFERENCES inventory(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  location_id  INTEGER NOT NULL REFERENCES warehouse_locations(id),
  system_qty   INTEGER NOT NULL,
  counted_qty  INTEGER,
  counted_by   INTEGER REFERENCES users(id),
  counted_at   TEXT
);

-- Libro de movimientos de stock: cada cambio de cantidad o de reserva deja una fila
CREATE TABLE inventory_movements (
  id                INTEGER PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('ingreso', 'egreso', 'reserva', 'liberacion', 'traslado', 'ajuste')),
  product_id        INTEGER NOT NULL REFERENCES products(id),
  from_location_id  INTEGER REFERENCES warehouse_locations(id),
  to_location_id    INTEGER REFERENCES warehouse_locations(id),
  quantity          INTEGER NOT NULL,
  order_id          INTEGER REFERENCES orders(id),
  count_id          INTEGER REFERENCES inventory_counts(id),
  user_id           INTEGER NOT NULL REFERENCES users(id),
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL
);

CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  order_id    INTEGER REFERENCES orders(id),
  product_id  INTEGER REFERENCES products(id),
  read_at     TEXT,
  created_at  TEXT NOT NULL
);

-- Historial: todo lo que pasa en el sistema
CREATE TABLE activity (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL,
  message      TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  order_id     INTEGER REFERENCES orders(id),
  product_id   INTEGER REFERENCES products(id),
  location_id  INTEGER REFERENCES warehouse_locations(id),
  sector       TEXT,
  quantity     INTEGER,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_inventory_product   ON inventory(product_id);
CREATE INDEX idx_inventory_location  ON inventory(location_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_company      ON orders(company_id);
CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_alloc_item          ON order_allocations(order_item_id);
CREATE INDEX idx_alloc_inventory     ON order_allocations(inventory_id);
CREATE INDEX idx_history_order       ON order_status_history(order_id);
CREATE INDEX idx_comments_order      ON comments(order_id);
CREATE INDEX idx_movements_product   ON inventory_movements(product_id, created_at);
CREATE INDEX idx_activity_created    ON activity(created_at);
CREATE INDEX idx_notifications_user  ON notifications(user_id, read_at);
CREATE INDEX idx_count_lines         ON inventory_count_lines(count_id);
CREATE INDEX idx_positions_rack      ON rack_positions(rack_id);

-- los números de pedido arrancan en #00470 (continúan la numeración en papel)
INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', 469);
`

/** V2: permisos por perfil editables desde la administración. */
const V2 = (db: Db) => {
  db.exec('CREATE TABLE role_permissions (role TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY (role, permission))')
  seedRolePermissions(db)
}

/** V3: pedidos de presupuesto desde el Diseñador 3D. */
const V3 = `
CREATE TABLE quotes (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  config      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  comments    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo', 'respondido')),
  created_at  TEXT NOT NULL
);
`

/** V4: quién respondió cada presupuesto y a qué pantalla lleva cada notificación. */
const V4 = `
ALTER TABLE quotes ADD COLUMN answered_at TEXT;
ALTER TABLE quotes ADD COLUMN answered_by INTEGER REFERENCES users(id);
ALTER TABLE notifications ADD COLUMN link TEXT;
`

/**
 * V5: cantidad del sistema al cerrar cada conteo. Sin esto, un conteo confirmado se comparaba
 * contra el stock ya ajustado y dejaba de mostrar sus diferencias. Los conteos ya cerrados se
 * reconstruyen con los ajustes que generaron.
 */
const V5 = `
ALTER TABLE inventory_count_lines ADD COLUMN final_qty INTEGER;
UPDATE inventory_count_lines SET final_qty = CASE
    WHEN counted_qty IS NOT NULL AND (SELECT status FROM inventory_counts c WHERE c.id = inventory_count_lines.count_id) = 'confirmado'
      THEN counted_qty - COALESCE((
        SELECT SUM(m.quantity) FROM inventory_movements m
         WHERE m.type = 'ajuste' AND m.count_id = inventory_count_lines.count_id AND m.product_id = inventory_count_lines.product_id
           AND inventory_count_lines.location_id IN (m.from_location_id, m.to_location_id)), 0)
    ELSE system_qty
  END
 WHERE count_id IN (SELECT id FROM inventory_counts WHERE status <> 'en_curso');
`

const MIGRATIONS: (string | ((db: Db) => void))[] = [V1, V2, V3, V4, V5]

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")
  let version = row ? Number(row.value) : 0
  while (version < MIGRATIONS.length) {
    db.transaction(() => {
      const step = MIGRATIONS[version]
      if (typeof step === 'string') db.exec(step)
      else step(db)
      version++
      db.run("INSERT INTO meta (key, value) VALUES ('schema_version', :v) ON CONFLICT(key) DO UPDATE SET value = :v", { v: String(version) })
    })
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length
