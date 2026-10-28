# Sistemas de Carga · Gestión

App de gestión para Sistemas de Carga S.A. Funciona en PC (barra lateral) y en el celular
(barra inferior). Está organizada en tres fases, cada una con su color:

| Fase | Pantallas | Qué resuelve |
|---|---|---|
| **1 · Pedidos** (rojo) | Pedidos, Nuevo pedido, Detalle, Preparación | Solicitar materiales y seguir cada pedido: Solicitado → En revisión → Aprobado → En preparación → Preparado → Entregado → Finalizado, o Cancelado. |
| **2 · Almacén** (ámbar) | Almacén (plano 2D y vista 3D), Inventario, Faltantes | Dónde está cada producto (rack, nivel, posición), cuánto hay, qué está reservado y qué falta. |
| **3 · Control** (azul acero) | Tablero, Conteo, Historial | Conteos físicos con diferencias, y el registro de todo lo que pasa. |

Además, el **Cotizador 3D** arma un rack selectivo paso a paso y lo muestra en 3D con sus
medidas; el rack se puede **agregar al almacén** (sus posiciones pasan a ser ubicaciones reales)
o mandar como **pedido de presupuesto** (le llega al administrador en *Administración → Presupuestos*).

### Cotizador 3D

También existe **suelto**, sin login, pedidos ni almacén (`cotizador.html`, código en `src/cotizador/`).
Usa el mismo motor, 3D y panel que la app, así que cualquier mejora sirve para los dos.

```bash
npm run build:cotizador
```

Genera `../cotizador-3d.html`: un solo archivo que se abre con doble clic o se sube a cualquier
hosting. Como no tiene servidor, "Pedir presupuesto" arma el pedido (datos de contacto, configuración
y lista de materiales) en un email para info@sistemasdecargas.com.ar, o lo copia para mandarlo por
donde sea. En desarrollo se ve en `http://localhost:5174/cotizador.html`.

Arriba, **Rack / Depósito** cambia entre el rack y el **plano del depósito** (`src/web/plan/`,
geometría en `src/shared/plan/`): contorno dibujado punto por punto, paredes rectas o curvas (por
flecha, como la "bulge" de AutoCAD), medidas escritas a mano, columnas (sueltas o en grilla),
tabiques, portones y zonas libres, con imán a 10 cm, deshacer/rehacer y vista 3D. Por ahora el plano
se guarda en el navegador; ubicar los racks adentro y exportar a DXF son las próximas etapas.

- **Panel guiado** de 6 pasos con una ayuda en cada uno (producto, medidas, carga, estructura,
  accesorios, resumen), o **Ver todo** para tener todas las opciones juntas.
- **Tramos con medidas distintas**: un mismo rack puede tener partes con otra altura, otro largo de
  viga y otra cantidad de niveles. El bastidor compartido entre dos tramos toma la altura mayor y
  cada tramo lleva la viga que le corresponde.
- **Pallet a medida**, y **parante y viga elegibles** a mano (si no alcanzan para la carga, avisa).
- **Accesorios**: protectores de columna, guardarraíles de cabecera, conectores superiores, cruces de
  arriostramiento, carteles de capacidad, piso de madera o malla y travesaños de apoyo de pallet.
- **Lista de materiales** por medida, descargable en CSV y guardada con cada pedido de presupuesto.
  Los **precios** se cargan en `PRICE_LIST` (`src/shared/rack/technicalSpecs.ts`) por código de pieza;
  con todos los precios cargados, muestra el total.
- Catálogo de productos en `src/shared/catalog.ts`: por ahora sólo el rack selectivo está habilitado;
  los demás (pasarela, penetrable, estanterías, entrepisos, carros móviles, lockers) figuran como
  "Próximamente". Un rack con varios tramos todavía no se puede agregar al mapa del almacén.

Todo está conectado: aprobar un pedido reserva stock en posiciones concretas, entregarlo lo
descuenta, un conteo ajusta las cantidades, y cada cambio queda en el historial.

---

## Cómo usarla

Requisitos: **Node.js 24** o más nuevo (usa `node:sqlite`). Primero, una sola vez:

```bash
npm install
```

### 1. Demo sin servidor (un solo archivo)

```bash
npm run build:html
```

Genera `../sistemas-de-carga-gestion.html` con todo adentro (app, logo y la base de datos
SQLite compilada a WebAssembly). Se abre con doble clic. Cada navegador guarda **sus propios
datos**; el botón *Restablecer demo* vuelve al estado inicial.

### 2. Servidor para la empresa (PC + celulares en la misma red)

```bash
npm run server
```

Compila la interfaz y levanta el servidor en el puerto 8787. En la consola aparecen dos
direcciones: la de la computadora (`http://localhost:8787`) y la de la red local
(`http://192.168.x.x:8787`) para abrir desde el celular conectado al mismo Wi‑Fi.
Todos comparten la misma base: `data/sdc.db`.

La primera vez carga los datos de demostración. Para arrancar **sin datos de ejemplo**,
con un administrador propio (en PowerShell):

```powershell
$env:DEMO="0"; $env:ADMIN_EMAIL="nombre@empresa.com"; $env:ADMIN_PASSWORD="una-clave-larga"; $env:ADMIN_NAME="Nombre Apellido"; npm run server
```

Eso crea la empresa, el almacén con sus zonas de Recepción y Despacho y el usuario
administrador. El resto (usuarios, productos y racks) se carga desde la app.

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `8787` |
| `DB_PATH` | Archivo de la base | `data/sdc.db` |
| `DEMO` | `0` = sin datos de ejemplo | demo activada |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Primer administrador (sólo con base vacía y `DEMO=0`) | — |
| `COMPANY_NAME`, `WAREHOUSE_NAME`, `WAREHOUSE_LENGTH_MM`, `WAREHOUSE_WIDTH_MM` | Datos iniciales opcionales | Sistemas de Carga S.A., 32 × 22 m |

> En la red local la conexión es HTTP. Para publicarla en internet hay que ponerla detrás
> de HTTPS (por ejemplo, un proxy inverso con certificado).

### Publicar la demo en Vercel o Netlify

```bash
npm run build
```

Deja en `dist/` (con el **cotizador como página principal** y la app de gestión en `/gestion`) la versión que funciona sola en el navegador (como el HTML único, pero en
archivos separados). Se publica tal cual en cualquier hosting estático:

- **Vercel:** `npx vercel deploy dist --prod` (pide iniciar sesión la primera vez), o importar
  el proyecto: `vercel.json` ya indica el comando y la carpeta.
- **Netlify:** arrastrar la carpeta `dist` a <https://app.netlify.com/drop>, o conectar el
  proyecto: `netlify.toml` ya indica el comando y la carpeta.

Cada visitante tiene sus propios datos. La versión con base compartida (`npm run server`)
necesita un servidor con disco (una PC de la empresa, un VPS o un servicio con volumen
persistente); no corre en un hosting estático. Si se publica la compilación para servidor
en un hosting estático, el ingreso da error porque no encuentra `/api`.

### 3. Para seguir desarrollando

```bash
npm run dev          # interfaz + servidor dentro del navegador (http://localhost:5174)
npm test             # pruebas de los flujos de negocio
```

Para desarrollar contra el servidor Node: `npm run api` en una terminal y
`npm run dev:server` en otra (Vite redirige `/api` al puerto 8787).

---

## Cuentas de demostración

Contraseña de todas: **demo1234** (también aparecen en la pantalla de ingreso).

| Usuario | Perfil | Qué puede hacer |
|---|---|---|
| lucia@sdc.demo | Administrador | Todo: usuarios, perfiles y permisos, productos, racks, presupuestos |
| martin@sdc.demo | Encargado de almacén | Revisar y aprobar, ubicar stock, recibir reposiciones, conteos |
| diego@sdc.demo · ana@sdc.demo | Operario | Preparar los pedidos asignados (checklist) |
| juan@sdc.demo | Cliente (sector Producción) | Pedir materiales, seguirlos, comentar, confirmar recepción |
| carolina@andina.demo | Cliente (Logística Andina S.A.) | Lo mismo, para otra empresa |

El pedido **#00482** es el ejemplo completo: en preparación, con 2 protectores faltantes,
comentarios, y la viga reservada en **A-04-03-02**. La reposición **#00483** trae esos
protectores: al recibirla y reintentar la reserva, el #00482 se puede terminar.

---

## Arquitectura

```
src/
  shared/          tipos y reglas que usan el servidor y la interfaz
    types.ts         todos los datos que viajan por la API
    orders.ts        estados, colores, transiciones permitidas
    permissions.ts   permisos y perfiles (valores de fábrica)
    stock.ts         estados de stock y de posición
    rack/            motor del rack selectivo (cálculo, reglas, datos técnicos, resumen)
  server/
    db/              acceso a SQLite (node:sqlite en Node, sql.js en el navegador) y migraciones
    core/            servicios: pedidos, inventario, almacén, conteos, usuarios, permisos,
                     notificaciones, historial, presupuestos, tablero (+ pruebas)
    api/app.ts       API REST (Hono) con validación (zod) y sesión por token
    node.ts          servidor Node: API + interfaz compilada
    browser.ts       el mismo servidor corriendo dentro del navegador (modo demo)
    seed.ts          datos de demostración (se cargan usando los servicios)
    bootstrap.ts     primer arranque sin demo
  web/             interfaz React (rutas, pantallas, componentes, estilos)
    three/           escena 3D del rack (Three.js / React Three Fiber)
```

**Un solo servidor, dos lugares donde correr.** La API es la misma en los dos modos:

- **local** (`npm run dev`, HTML único): el servidor y la base corren dentro del navegador;
  los datos se guardan en IndexedDB. Ideal para mostrar la app sin instalar nada.
- **http** (`npm run server`): la interfaz habla por HTTP con el servidor Node; la base es un
  archivo y la comparten todos los dispositivos.

Cada operación de negocio es una función del servidor que recibe quién la hace
(`ctx.actor`, con sus permisos leídos de la base), valida, escribe en una transacción y
registra movimientos, historial y notificaciones. La interfaz nunca cambia datos por su
cuenta: llama a la API y vuelve a leer.

### Modelo de datos

| Tabla | Contenido |
|---|---|
| `companies`, `users`, `sessions` | Empresas (interna o cliente) con sus sectores, usuarios y sesiones |
| `role_permissions` | Permisos de cada perfil (editables en *Administración → Perfiles y permisos*) |
| `products` | Catálogo con stock mínimo |
| `warehouses`, `warehouse_locations` | Almacén y ubicaciones: posiciones de rack y zonas de piso (Recepción, Despacho) |
| `racks`, `rack_positions` | Racks (con la configuración del Diseñador) y sus posiciones `PASILLO-RACK-NIVEL-POSICIÓN` |
| `inventory` | Cantidad y cantidad reservada de cada producto en cada ubicación |
| `orders`, `order_items`, `order_status_history` | Pedidos, sus productos y cada cambio de estado |
| `order_allocations` | Qué unidades de qué ubicación están reservadas para qué línea de pedido |
| `inventory_movements` | Ingresos, egresos, reservas, liberaciones, traslados y ajustes |
| `inventory_counts`, `inventory_count_lines` | Conteos: cantidad del sistema al iniciar, conteo físico y la del sistema al cerrar |
| `comments`, `notifications`, `activity` | Comentarios, avisos por usuario e historial general |
| `quotes` | Pedidos de presupuesto del Diseñador 3D |

Regla que se verifica en las pruebas: lo reservado en cada ubicación es siempre la suma de
sus reservas activas, y nunca supera lo que hay.

**Migraciones:** `src/server/db/schema.ts` tiene la lista `MIGRATIONS`. Para cambiar la base
se agrega un paso al final (nunca se edita uno existente); al arrancar, cada base aplica los
pasos que le faltan. Así una base con datos se actualiza sin perderlos.

### Dónde se cambia cada cosa

| Qué | Dónde |
|---|---|
| Estados, colores y transiciones de pedidos | `src/shared/orders.ts` |
| Permisos de fábrica de cada perfil | `src/shared/permissions.ts` (y en la app, *Perfiles y permisos*) |
| Medidas, perfiles, cargas y reglas de los racks | `src/shared/rack/technicalSpecs.ts` y `rules.ts` |
| Precios de las piezas del cotizador | `PRICE_LIST` en `src/shared/rack/technicalSpecs.ts` |
| Piezas de la lista de materiales | `src/shared/rack/bom.ts` |
| Productos del cotizador | `src/shared/catalog.ts` |
| Colores y tipografías | variables al principio de `src/web/styles/app.css` |
| Datos de demostración | `src/server/seed.ts` |

### Notificaciones push

Hoy las notificaciones se muestran dentro de la app (campana). Están preparadas para push:
`src/server/core/notifications.ts` tiene la lista `CHANNELS`; un canal nuevo (Web Push con
service worker, o Firebase para una app nativa) recibe la misma notificación ya armada
(título, texto y la pantalla a la que lleva) y la manda al dispositivo. No hace falta tocar
los servicios que la generan.

---

## Qué es real y qué es de muestra

- **Real:** estados, reservas, cantidades, movimientos, conteos, permisos, historial,
  notificaciones y presupuestos están guardados y conectados entre sí; las pruebas
  (`npm test`) recorren esos flujos de punta a punta.
- **De muestra:** el catálogo de 20 productos, las cantidades, los usuarios y los pedidos de
  la demo son ilustrativos. Los datos técnicos de los racks son referencias para simular,
  no reemplazan el cálculo estructural del departamento técnico.
- **Presupuestos:** quedan guardados y avisan al administrador; la respuesta se manda por
  email por fuera de la app y se marca como respondida (eso le avisa al cliente).
- **Contraseñas:** se guardan con PBKDF2 (nunca en texto plano).
