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

La app **no trae los datos dentro**: los descarga al abrirse de dos Excel compartidos en OneDrive/SharePoint, y guarda
una copia en el teléfono para usarla sin conexión.

| Excel | Para qué | Dónde se configura |
|---|---|---|
| Catálogo (hoja `VIGENTES`) | Proveedores, productos, artículos, costos, cobertura y vigencia | `LINK_EXCEL` en [`src/data/vinculos.ts`](src/data/vinculos.ts) |
| Imágenes (hojas `PROVEEDORES`, `PRODUCTOS`, `ARTICULOS`) | Foto o logotipo de cada uno (columna `IMAGEN`) | `LINK_IMAGENES` en el mismo archivo |

Los dos deben estar compartidos como **"Cualquier persona con el vínculo puede ver"**. Si se reemplaza un archivo en
OneDrive conservando el nombre, el vínculo no cambia y la app toma los datos nuevos sola; si cambia el vínculo, hay que
actualizarlo en `vinculos.ts` y publicar una versión nueva.

Las reglas para leer el catálogo (fila de encabezados, claves, cobertura `NAL`, conteo por `ART.` distinto) son las
mismas que usa el tablero `app_mosaic.py`, para que las cifras coincidan.

En la versión web, el navegador no puede leer SharePoint directamente (CORS), así que el servidor de la app lo descarga
por ella: [`src/app/api/excel+api.ts`](src/app/api/excel+api.ts).

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

El Excel de imágenes se mantiene con el script [`scripts/imagenes.mjs`](scripts/imagenes.mjs). Parte del Excel de
OneDrive, agrega los proveedores, productos y artículos nuevos del catálogo y regenera
[`src/data/imagenes.json`](src/data/imagenes.json), que son las fotos que trae la app por si no hay conexión la primera
vez.

```bash
npm run imagenes               # actualiza el Excel y imagenes.json
npm run imagenes:buscar        # además busca fotos por código de barras (Open Food Facts, Chedraui)
npm run imagenes:sugerencias   # sugiere fotos por nombre para revisarlas (columna APROBAR)
```

El Excel resultante queda en `datos/imagenes.xlsx`: **súbelo a OneDrive reemplazando el anterior** (mismo nombre) para
que la app lo use. En la columna `IMAGEN` va la dirección de la imagen (clic derecho → "Copiar dirección de imagen"),
no la de la página, y no vínculos de Facebook o Instagram, que no cargan fuera del navegador.

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
src/data/              Lectura del Excel, búsqueda, imágenes, tema y vínculos de OneDrive
scripts/               Mantenimiento del Excel de imágenes
assets/images/         Íconos y pantalla de inicio
public/                Ícono y manifiesto de la versión web
datos/                 Excel y cachés locales de los scripts (no se suben al repositorio)
```

Las carpetas `android/` e `ios/` no existen a propósito: Expo las genera al compilar. Lo nativo (ícono, colores,
nombre del paquete) se configura en [`app.json`](app.json).

---

Subgerencia de Abarrotes · Alimentación para el Bienestar · Gobierno de México
