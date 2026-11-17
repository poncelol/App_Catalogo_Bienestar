# Abasto Bienestar

App móvil (Android, iPhone y web) para consultar el catálogo del **Programa de Abasto Rural 2026** de la Subgerencia
de Abarrotes · Alimentación para el Bienestar: proveedores, productos, artículos, cobertura por gerencia regional y
vigencia de las negociaciones.

Hecha con [Expo](https://expo.dev) (SDK 57) y Expo Router.

## Qué hace

| Pestaña | Contenido |
|---|---|
| **Inicio** | Cifras generales, aviso de vigencia y resumen por tipo de inventario, productos, cobertura regional y proveedores. |
| **Artículos** | Búsqueda por nombre, marca o código de barras, con filtros y vista de lista o cuadrícula. |
| **Productos** | Los productos (PROD.) con sus artículos y precio desde. |
| **Regiones** | Mapa de las 12 gerencias regionales y sus unidades operativas, y los artículos de cada una. |
| **Proveedores** | Los proveedores (CVE) con su catálogo. |

Tiene modo claro, oscuro y automático (botón en el encabezado de Inicio) y funciona sin conexión con la última copia
descargada.

## De dónde salen los datos

La app **no trae los datos dentro**: al abrirse, y cada 15 minutos mientras está abierta, los pide al **servidor de
Cloudflare**. Guarda una copia en el teléfono para usarla sin conexión. El servidor está en otro repositorio,
**BienestarBackend** (carpeta vecina `App Movil/BienestarBackend`); ahí se explica cómo publicarlo y administrarlo.

| Dato | De dónde lo toma el servidor | Cómo se cambia |
|---|---|---|
| Catálogo (Excel, hoja `VIGENTES`) | Lo descarga de SharePoint cada 15 minutos | Se edita el Excel en SharePoint |
| Imágenes de proveedores, productos y artículos | Base de datos del servidor | Con `admin_bienestar.py` (BienestarBackend) |
| Regiones (nombre, clave, unidades operativas) | Base de datos del servidor | Con `admin_bienestar.py`, hoja `REGIONES` |

La dirección del servidor es `SERVIDOR`, en [`src/data/vinculos.ts`](src/data/vinculos.ts).

**Los vínculos de los Excel no van en el código** (se sube a git y viaja dentro de la app): `LINK_EXCEL` y
`LINK_IMAGENES` están vacíos a propósito. El servidor guarda el del catálogo como secreto, y los scripts de esta
computadora los leen de `datos/config.json`, que git ignora:

```json
{ "linkCatalogo": "https://….sharepoint.com/:x:/g/…", "linkImagenes": "https://….sharepoint.com/:x:/g/…" }
```

Las reglas para leer el catálogo (fila de encabezados, claves, cobertura `NAL`, conteo por `ART.` distinto) son las
mismas que usa el tablero `app_mosaic.py`, para que las cifras coincidan.

## Requisitos

- Node.js 20 o más reciente
- Para probar en el teléfono: la app **Expo Go** (Android o iPhone)
- Para generar el APK: una cuenta gratuita en [expo.dev](https://expo.dev)

## Correr la app

```bash
npm install
npx expo start          # escanea el código QR con Expo Go
npx expo start --web    # versión web en el navegador
```

Si un cambio no aparece, reinicia limpiando la caché: `npx expo start --clear`.

Antes de subir cambios:

```bash
npx tsc --noEmit        # revisión de tipos
npx expo lint           # lint
```

## Fotos del catálogo

Las fotos se administran en la base de datos del servidor con la ventana de `admin_bienestar.py` (repositorio
BienestarBackend). Muestra qué artículos, productos y proveedores no tienen foto, y permite buscarla en Chrome, pegar un
vínculo o subir un archivo.

El script [`scripts/imagenes.mjs`](scripts/imagenes.mjs) sigue sirviendo para el Excel de imágenes y para regenerar
[`src/data/imagenes.json`](src/data/imagenes.json), que son las fotos que trae la app por si no hay conexión la primera
vez. Toma los vínculos de `datos/config.json`.

```bash
npm run imagenes               # actualiza el Excel y imagenes.json
npm run imagenes:buscar        # además busca fotos por código de barras (Open Food Facts, Chedraui)
npm run imagenes:sugerencias   # sugiere fotos por nombre para revisarlas (columna APROBAR)
```

El Excel resultante queda en `datos/imagenes.xlsx`. Para que la app use lo que cambiaste ahí, súbelo al servidor desde
`admin_bienestar.py` (*Servidor › Carga completa desde el Excel*). En la columna `IMAGEN` va la dirección de la imagen
(clic derecho → "Copiar dirección de imagen"), no la de la página, y no vínculos de Facebook o Instagram, que no cargan
fuera del navegador.

## Generar el APK (Android)

Con [EAS Build](https://docs.expo.dev/build/introduction/) el APK se compila en la nube; no hace falta Android Studio.

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

Al terminar, EAS da un vínculo para descargar el APK e instalarlo en el teléfono (hay que permitir "instalar apps
de origen desconocido"). El perfil `preview` de [`eas.json`](eas.json) genera APK; `production` genera el AAB para la
Play Store.

**iPhone:** Apple no permite instalar apps fuera de la App Store sin una cuenta de Apple Developer. Sin ella, se puede
usar Expo Go o la versión web agregada a la pantalla de inicio desde Safari (Compartir → Agregar a inicio).

## Publicar la versión web

```bash
npx expo export --platform web
npx eas-cli@latest deploy --prod
```

## Estructura

```
src/app/               Pantallas (Expo Router): una por pestaña, _layout.tsx y la API web de los Excel
src/components/abasto/ Componentes de la app (tarjetas, fotos, mapa, búsqueda, filtros, selector de tema)
src/data/              Lectura del Excel, búsqueda, imágenes, regiones, tema y dirección del servidor
scripts/               Mantenimiento del Excel de imágenes
assets/images/         Íconos y pantalla de inicio
public/                Ícono y manifiesto de la versión web
datos/                 Excel, cachés y config.json con los vínculos (no se suben al repositorio)
```

Las carpetas `android/` e `ios/` no existen a propósito: Expo las genera al compilar. Lo nativo (ícono, colores,
nombre del paquete) se configura en [`app.json`](app.json).

---

Subgerencia de Abarrotes · Alimentación para el Bienestar · Gobierno de México
