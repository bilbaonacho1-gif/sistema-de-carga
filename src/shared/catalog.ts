/**
 * CATÁLOGO DE PRODUCTOS que se pueden cotizar (sistemasdecargas.com.ar y SICSA).
 * `available` = ya tiene configurador 3D y lista de materiales; el resto se va sumando.
 *
 * Ojo: los dos sitios de la empresa publican cifras distintas (10 m contra 12 m de altura;
 * 1.500/3.000 kg por nivel contra vigas de 600 a 5.000 kg). Hay que confirmarlas con la
 * ficha técnica real antes de usarlas como límites.
 */

export type ProductGroup = 'Racks para pallets' | 'Estanterías' | 'Entrepisos' | 'Sistemas móviles' | 'Otros'

export interface ProductType {
  id: string
  group: ProductGroup
  name: string
  /** Para qué sirve, en una línea. */
  summary: string
  /** Datos técnicos publicados. */
  published: string
  /** Qué se le pide al cliente para cotizarlo. */
  asks: string[]
  available: boolean
}

export const PRODUCT_TYPES: ProductType[] = [
  {
    id: 'selectivo', group: 'Racks para pallets', name: 'Rack selectivo', available: true,
    summary: 'Acceso directo a cada pallet. Para mercadería que rota mucho (FIFO).',
    published: 'Hasta 10 m (12 m en línea estándar según SICSA). 1.500 kg por pallet y 3.000 kg por nivel; vigas de 600 a 5.000 kg por nivel.',
    asks: ['Alto, profundidad y largo de viga', 'Niveles y posiciones', 'Peso por pallet', 'Tramos con medidas distintas', 'Accesorios'],
  },
  {
    id: 'pasarela', group: 'Racks para pallets', name: 'Selectivo con pasarela', available: false,
    summary: 'Rack selectivo con pisos metálicos en 1, 2 o 3 niveles para circular arriba.',
    published: 'Pasarelas de hasta 2.000 kg/m².',
    asks: ['Todo lo del selectivo', 'Niveles de pasarela (1 a 3)', 'Carga de la pasarela en kg/m²'],
  },
  {
    id: 'penetrable', group: 'Racks para pallets', name: 'Rack penetrable (drive-in)', available: false,
    summary: 'Alta densidad: el autoelevador entra al rack. Para mercadería homogénea de baja rotación.',
    published: 'Hasta 3.000 kg por pallet. LIFO con una entrada o FIFO con dos.',
    asks: ['Alto y frente', 'Profundidad en pallets', 'Una o dos entradas', 'Peso por pallet'],
  },
  {
    id: 'estanteria', group: 'Estanterías', name: 'Estantería metálica', available: false,
    summary: 'Carga manual y picking. Chapa laminada en frío, pintura horneada, estantes regulables.',
    published: 'Estantes de altura regulable.',
    asks: ['Alto, frente y fondo', 'Cantidad de estantes', 'Kg por estante'],
  },
  {
    id: 'estanteria-entrepiso', group: 'Estanterías', name: 'Estantería con entrepiso', available: false,
    summary: 'Estanterías que sostienen un nivel superior por el que se camina.',
    published: '',
    asks: ['Alto, frente y fondo', 'Cantidad de estantes', 'Kg por estante', 'Superficie del entrepiso'],
  },
  {
    id: 'entrepiso', group: 'Entrepisos', name: 'Entrepiso normalizado', available: false,
    summary: 'Desmontable, de montaje en seco, con piso entablillado y vigas primarias y secundarias.',
    published: 'De 300 a 3.000 kg/m², con luces de hasta 12 m entre columnas.',
    asks: ['Superficie (m²)', 'Altura', 'Carga en kg/m²', 'Luz entre columnas'],
  },
  {
    id: 'moviles', group: 'Sistemas móviles', name: 'Carros móviles', available: false,
    summary: 'Estanterías o racks sobre rieles: comparten un solo pasillo. Hasta 50% más de espacio.',
    published: 'Manuales o con asistencia mecánica.',
    asks: ['Cantidad de módulos', 'Largo del riel', 'Manual o asistido'],
  },
  {
    id: 'lockers', group: 'Otros', name: 'Lockers / guardarropas', available: false,
    summary: 'De chapa de acero, para supermercados, colegios, gimnasios y oficinas.',
    published: '',
    asks: ['Cantidad de cuerpos', 'Puertas por cuerpo'],
  },
]
