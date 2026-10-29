# Material para el cliente (Sistemas de Carga)

## Documentos (`documentos/`)
| Archivo | Qué es |
|---|---|
| `Disenador-3D-de-depositos_Alcance-para-aprobacion_v2.pdf` | Resumen de requerimientos y alcance de la primera etapa, para que el cliente lo apruebe o corrija. Incluye el pedido de Gabriel: pallet y carga editables por separado (R6). |
| `Disenador-3D-de-depositos_Presupuesto-Etapa-1.pdf` | Presupuesto solo de la Etapa 1 (base), en pesos: 3 cuotas sin interés o 6 con interés, con qué incluye y qué no. Versión recomendada para enviar. |
| `Disenador-3D-de-depositos_Presupuesto.pdf` | Presupuesto solo (2 páginas) para enviar después del alcance aprobado: precios, plazos, pagos y condiciones. |
| `presupuesto-disenador-3d.pdf` | Presupuesto por etapas con precios en USD, plazos, forma de pago y condiciones (propuesta inicial). |

Fuentes en `documentos/fuentes/` (HTML + imágenes). Para regenerar un PDF:
`node make.mjs <ruta absoluta al .html> <salida.pdf>` (usa Playwright/Chromium).

## Videos (`videos/`)
| Archivo | Qué es |
|---|---|
| `rack-selectivo-armado.mp4` | Partes y armado del rack selectivo en 10 pasos (1:39, 1080p). |
| `rack-americano-armado.mp4` | Rack americano para revendedores: ficha, partes, encastre y armado en 6 pasos (1:20, 1080p). |

Fuentes en `videos/fuentes/` (escenas three.js). Para renderizar: instalar `three@0.160.0` junto a los
HTML y correr `PAGE=americano.html node render2.mjs video 30 salida.mp4` (o `scene.html` para el selectivo).

## Referencias (`referencias/`)
Plano actual en AutoCAD y fotos/video del rack americano que mandó el cliente.
