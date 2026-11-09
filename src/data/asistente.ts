/**
 * Asistente del catálogo: consultas a los datos y revisión de lo que responde el modelo de IA.
 *
 * El modelo corre en el dispositivo (ver motor-ia), es pequeño y no conoce el catálogo. Por eso no decide qué buscar:
 * la app entiende la pregunta, consulta los artículos ya descargados (consultarCatalogo) y le pasa los datos; el
 * modelo solo redacta la respuesta con ellos. Este archivo no depende de la librería del modelo, para poder
 * probarlo y usarlo en cualquier plataforma.
 */
import {
  REGIONES, SIGLAS, contar, diasVigencia, dinero, fechaCorta, fechaLarga, hoyISO, nArt, sinAcentos, type Articulo,
} from '@/data/abasto';
import { filtrarArticulos, palabras, type Orden } from '@/data/busqueda';

/** Consulta al catálogo con su descripción (el formato de herramientas de los modelos de IA). */
export type Herramienta = {
  type: 'function';
  function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] } };
  execute: (args: Record<string, unknown>) => string;
};

/** Mensaje de la conversación tal como se muestra. */
export type Mensaje = {
  id: string;
  rol: 'usuario' | 'asistente';
  texto: string;
  /** Artículos que encontró la consulta al catálogo, para mostrarlos bajo la respuesta. */
  articulos?: Articulo[];
  /** Mientras el modelo escribe la respuesta. */
  pendiente?: boolean;
  error?: boolean;
  /** Advertencia cuando la respuesta trae datos que no salieron del catálogo (ver revisarRespuesta). */
  aviso?: string;
  /** Pregunta que originó una respuesta con error, para poder reintentarla. */
  pregunta?: string;
  /** Proveedores o productos que se pidieron («¿quién vende aceite?»), como tarjetas. */
  proveedores?: Grupo[];
  productos?: Grupo[];
  /** Lo que la app entendió que se buscó («vinagre · región Metropolitana»), para que se note si tomó la pregunta anterior. */
  entendido?: string;
};

export type PropsChat = {
  mensajes: Mensaje[];
  setMensajes: (f: (m: Mensaje[]) => Mensaje[]) => void;
  onVerArticulo: (a: Articulo) => void;
  onVerProveedor: (cve: string) => void;
  onVerProducto: (prod: string) => void;
};

/** En qué va el modelo: revisando si ya está descargado, descargando, cargando en memoria, listo o con error. */
export type EstadoMotor =
  | { fase: 'revisando' }
  | { fase: 'descargando'; progreso: number }
  | { fase: 'cargando'; progreso?: number }
  | { fase: 'listo' }
  | { fase: 'error'; tipo: 'descarga' | 'carga' | 'navegador' | 'app'; detalle: string };

/** Lo que el chat necesita del modelo; cada plataforma lo implementa con su librería (motor-ia). */
export type Motor = {
  estado: EstadoMotor;
  /** Manda el mensaje (pregunta con datos, ver mensajeConDatos); `onCrudo` recibe todo lo escrito hasta el momento. */
  enviar: (mensaje: string, onCrudo: (crudo: string) => void) => Promise<{ texto: string; cancelado: boolean }>;
  detener: () => void;
  /** Memoria de contexto del modelo (en tokens) que queda para cada pregunta: instrucciones, datos y respuesta. */
  contexto: number;
};

/** Cuántos artículos se le pasan al modelo por consulta, como mucho (más haría lenta la respuesta en el teléfono). */
const MAX_ARTICULOS = 8;
/** Largo máximo de la respuesta, en tokens. */
export const RESPUESTA_MAX = 400;

/**
 * Cuántos caracteres de datos caben en la memoria del modelo: lo que queda tras las instrucciones, la pregunta y
 * la respuesta. Se cuentan unos 2.6 caracteres por token (los nombres en mayúsculas y los números rinden menos
 * que el texto normal).
 */
export function presupuestoDatos(contexto: number) {
  const tokens = contexto - Math.ceil(instrucciones().length / 2.6) - 150 - RESPUESTA_MAX;
  return Math.max(1500, Math.floor(tokens * 2.6));
}

export function instrucciones() {
  return [
    'Eres el asistente del catálogo de artículos del Programa de Abasto Rural 2026 de Alimentación para el Bienestar.',
    'Responde siempre en español, con palabras sencillas, como le explicarías a una persona que no conoce el sistema.',
    'Cada mensaje trae los "Datos del catálogo" consultados para esa pregunta. Usa SOLO esos datos: no inventes artículos, precios ni cantidades.',
    'Forma de responder:',
    '- Empieza contestando directo la pregunta en una frase (por ejemplo: "Encontré 12 artículos de vinagre; el más económico es…").',
    '- Si hay varios, menciona solo 2 o 3 de los más útiles, cada uno en una viñeta con nombre, marca, presentación y precio.',
    '- Si preguntan por proveedores, di cuántos son (el número que traen los datos) y nombra los 3 con más artículos, con cuántos artículos tiene cada uno.',
    '- No copies los datos tal cual ni uses claves, códigos o abreviaturas (ART., CVE, PROD., c/u): escribe frases completas.',
    '- Si los datos traen una "Comparación", empieza por su "Conclusión" y luego da la cifra principal de cada lado.',
    '- Si traen varias partes ("Parte 1", "Parte 2"), contesta cada parte en su propia viñeta, en el mismo orden.',
    '- Las cuentas ya están hechas (totales, precio más bajo, más alto, promedio y precio por litro o kilo): repítelas tal cual, no calcules.',
    '- Para decir qué conviene más entre presentaciones distintas, usa el precio por litro o por kilo, no el de la pieza.',
    '- Si una búsqueda dice que no se encontraron artículos, dilo claro y sugiere quitar algún filtro.',
    '- Termina, si aplica, diciendo que el resto está en las tarjetas de abajo. Máximo 6 líneas en total.',
    'Si no hay datos, di amablemente que solo puedes ayudar con el catálogo y da un ejemplo de pregunta, como "¿qué aceites hay?".',
    'Los precios son por pieza, en pesos mexicanos.',
    `Hoy es ${fechaLarga(hoyISO())}.`,
  ].join('\n');
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const numero = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(texto(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const contiene = (campo: string, consulta: string) => sinAcentos(campo).includes(sinAcentos(consulta));

/** Sigla de la región por sigla, nombre, estado o unidad operativa; null si no se reconoce. */
function sigla(consulta: string): string | null {
  const q = sinAcentos(consulta);
  if (!q) return null;
  return SIGLAS.find((s) => sinAcentos(s) === q || sinAcentos(REGIONES[s].nombre) === q)
    ?? SIGLAS.find((s) => [REGIONES[s].nombre, ...REGIONES[s].estados, ...REGIONES[s].unidades].some((l) => sinAcentos(l).includes(q)))
    ?? null;
}

function vigencia(a: Articulo) {
  const d = diasVigencia(a);
  if (d === null) return 'sin fecha de vigencia';
  return d < 0 ? `vencido desde ${fechaCorta(a.vigencia!)}` : `vigente al ${fechaCorta(a.vigencia!)}`;
}

/** Contenido de una pieza en litros o kilos («12 × 946 ML» → 0.946 litros); null si se vende por piezas. */
function medida(a: Articulo): { cantidad: number; unidad: 'litro' | 'kilo' } | null {
  const m = a.presentacion.match(/[×x]\s*(\d+(?:[.,]\d+)?)\s*(ML|LTS?|L|GRS?|G|KGS?)\b/i);
  const n = m ? Number(m[1].replace(',', '.')) : 0;
  if (!m || !n) return null;
  const u = m[2].toUpperCase();
  if (u === 'ML') return { cantidad: n / 1000, unidad: 'litro' };
  if (u.startsWith('L')) return { cantidad: n, unidad: 'litro' };
  if (u.startsWith('G')) return { cantidad: n / 1000, unidad: 'kilo' };
  return { cantidad: n, unidad: 'kilo' };
}

/** Precio por litro o por kilo: así se comparan presentaciones distintas (500 ml contra 1 litro). */
function porMedida(a: Articulo) {
  const m = medida(a);
  return m && a.costoUnit !== null ? { precio: a.costoUnit / m.cantidad, unidad: m.unidad } : null;
}

function renglon(a: Articulo) {
  const cobertura = a.alcance === 'Nacional' ? 'todo el país' : a.regiones.map((s) => REGIONES[s]?.nombre ?? s).join(', ') || 'sin cobertura';
  const inventario = a.inventario === 'Oferta' ? 'en oferta' : `inventario ${a.inventario}`;
  // Datos con etiquetas, en frases: así el modelo los repite en palabras y no como una tabla
  const pm = porMedida(a);
  return `- ${a.articulo}, marca ${a.marca}, presentación ${a.presentacion}. Precio: ${dinero(a.costoUnit)} por pieza`
    + `${pm ? ` (${dinero(pm.precio)} el ${pm.unidad})` : ''}. `
    + `Proveedor: ${a.provCorto}. ${inventario}, ${vigencia(a)}. Se surte en: ${cobertura}. (ART. ${a.artId})`;
}

function rango(arts: Articulo[]) {
  const costos = arts.map((a) => a.costoUnit).filter((c): c is number => c !== null);
  if (!costos.length) return 'sin costo registrado';
  const [min, max] = [Math.min(...costos), Math.max(...costos)];
  return min === max ? dinero(min) : `de ${dinero(min)} a ${dinero(max)}`;
}

/**
 * Cifras de precio ya calculadas (más bajo, más alto, promedio), para que el modelo no tenga que hacer cuentas:
 * un modelo pequeño se equivoca al comparar o promediar, pero repite bien un dato.
 */
function precios(arts: Articulo[]) {
  const con = arts.filter((a): a is Articulo & { costoUnit: number } => a.costoUnit !== null);
  if (!con.length) return 'Sin precio registrado.';
  const barato = con.reduce((x, y) => (y.costoUnit < x.costoUnit ? y : x));
  const caro = con.reduce((x, y) => (y.costoUnit > x.costoUnit ? y : x));
  const promedio = con.reduce((s, a) => s + a.costoUnit, 0) / con.length;
  if (con.length === 1) return `Precio: ${dinero(barato.costoUnit)} por pieza.`;
  // Si todos se miden igual (litros o kilos), también el que sale más barato por litro o kilo
  const medidos = con.map((a) => ({ a, pm: porMedida(a) }));
  const unidad = medidos[0].pm?.unidad;
  const rinde = unidad && medidos.every((m) => m.pm?.unidad === unidad)
    ? medidos.reduce((x, y) => (y.pm!.precio < x.pm!.precio ? y : x))
    : null;
  return `Precio por pieza: el más bajo ${dinero(barato.costoUnit)} (${barato.articulo}, ${barato.marca}); `
    + `el más alto ${dinero(caro.costoUnit)} (${caro.articulo}, ${caro.marca}); promedio ${dinero(promedio)}.`
    + (rinde ? ` Por ${unidad}, el más barato es ${rinde.a.articulo} (${rinde.a.marca}, ${rinde.a.presentacion}) a ${dinero(rinde.pm!.precio)} el ${unidad}.` : '');
}

const lista = (cs: { etiqueta: string; valor: number }[], n = 5) =>
  cs.slice(0, n).map((c) => `${c.etiqueta} (${c.valor})`).join(', ') + (cs.length > n ? ` y ${cs.length - n} más` : '');

/**
 * Herramientas sobre el catálogo. `catalogo()` se llama en cada consulta para usar siempre los datos más recientes;
 * `alEncontrar` recibe los artículos de cada búsqueda para mostrarlos como tarjetas bajo la respuesta.
 * `completo` es todo el catálogo cuando `catalogo` ya viene acotado (por precio o por lo excluido).
 */
export function crearHerramientas(
  catalogo: () => Articulo[], alEncontrar: (arts: Articulo[]) => void, completo: () => Articulo[] = catalogo,
): Herramienta[] {
  return [
    {
      type: 'function',
      function: {
        name: 'buscar_articulos',
        description: 'Busca artículos del catálogo. Devuelve clave ART., nombre, marca, presentación, proveedor, costo unitario, tipo de inventario, vigencia y cobertura.',
        parameters: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'Palabras a buscar: nombre, marca, producto o código de barras. Ej. "aceite 900 ml"' },
            proveedor: { type: 'string', description: 'Nombre del proveedor' },
            inventario: { type: 'string', description: 'Tipo de inventario, p. ej. "PAR" u "Oferta"' },
            region: { type: 'string', description: 'Gerencia regional (sigla, nombre o estado) donde se surte' },
            precio_maximo: { type: 'number', description: 'Costo unitario máximo en pesos' },
            vence_en_dias: { type: 'number', description: 'Solo artículos cuya vigencia termina en esta cantidad de días o menos' },
            orden: { type: 'string', enum: ['relevancia', 'menor', 'mayor', 'nombre'], description: 'menor = más barato primero' },
          },
        },
      },
      execute: (args) => {
        const q = texto(args.texto);
        const prov = texto(args.proveedor);
        const inv = texto(args.inventario);
        const reg = texto(args.region);
        const sig = reg ? sigla(reg) : null;
        if (reg && !sig) return `No reconozco la región «${reg}». Regiones: ${SIGLAS.map((s) => `${s} ${REGIONES[s].nombre}`).join(', ')}.`;
        const max = numero(args.precio_maximo);
        const min = numero(args.precio_minimo);
        // 0: solo las cifras, sin la lista de artículos (cuando casi no queda memoria)
        const limite = args.limite === 0 ? 0 : numero(args.limite) ?? MAX_ARTICULOS;
        const dias = numero(args.vence_en_dias);
        const orden = (['relevancia', 'menor', 'mayor', 'nombre'] as const).find((o) => o === texto(args.orden)) as Orden | undefined;
        const hoy = hoyISO();
        const base = catalogo().filter((a) => {
          if (prov && !contiene(`${a.provCorto} ${a.proveedor}`, prov)) return false;
          if (inv && sinAcentos(a.inventario) !== sinAcentos(inv)) return false;
          if (sig && a.alcance !== 'Nacional' && !a.regiones.includes(sig)) return false;
          if (max !== null && (a.costoUnit === null || a.costoUnit > max)) return false;
          if (min !== null && (a.costoUnit === null || a.costoUnit < min)) return false;
          if (dias !== null) {
            const d = diasVigencia(a, hoy);
            if (d === null || d < 0 || d > dias) return false;
          }
          return true;
        });
        // Si lo buscado es un producto («aceite», «frijol»), solo ese producto: si no, «aceite» por precio
        // empezaría por el atún en aceite. Se revisa en todo el catálogo: si ningún aceite pasa los filtros, la
        // respuesta es «no hay», no el atún en aceite que sí los pasa
        const ps = palabras(q);
        const delProducto = (a: Articulo) => ps.every((p) => sinAcentos(a.producto).includes(p.length > 3 ? p.replace(/e?s$/, '') : p));
        const acotado = ps.length && completo().some(delProducto) ? base.filter(delProducto) : base;
        const encontrados = filtrarArticulos(acotado, { texto: q || undefined, orden });
        alEncontrar(encontrados);
        if (!encontrados.length) return 'No se encontraron artículos con esos criterios.';
        const resto = encontrados.length - limite;
        return [
          `${encontrados.length} ${encontrados.length === 1 ? 'artículo encontrado' : 'artículos encontrados'}. ${precios(encontrados)}`,
          limite ? `${resto <= 0 ? 'Son' : limite === 1 ? 'El primero' : `Los primeros ${limite}`}:` : '',
          ...encontrados.slice(0, limite).map(renglon),
        ].filter(Boolean).join('\n');
      },
    },
    {
      type: 'function',
      function: {
        name: 'consultar_proveedor',
        description: 'Datos de un proveedor: clave CVE, cuántos artículos tiene, sus productos, marcas, tipos de inventario, regiones y rango de costos.',
        parameters: {
          type: 'object',
          properties: { nombre: { type: 'string', description: 'Nombre o parte del nombre del proveedor' } },
          required: ['nombre'],
        },
      },
      execute: (args) => {
        const q = texto(args.nombre);
        const arts = catalogo();
        const proveedores = contar(arts.filter((a) => contiene(`${a.provCorto} ${a.proveedor} ${a.cve}`, q)), (a) => a.cve, (a) => a.provCorto);
        if (!q || !proveedores.length) return `No encontré proveedores que coincidan con «${q}».`;
        return proveedores.slice(0, 3).map(({ clave: cve }) => {
          const g = arts.filter((a) => a.cve === cve);
          alEncontrar(filtrarArticulos(g, {}));
          const nal = g.some((a) => a.alcance === 'Nacional');
          return [
            `Proveedor ${g[0].provCorto} (CVE ${cve}, razón social: ${g[0].proveedor})`,
            `Artículos: ${nArt(g)}. Costo unitario ${rango(g)}.`,
            `Productos: ${lista(contar(g, (a) => a.producto))}.`,
            `Marcas: ${lista(contar(g, (a) => a.marca))}.`,
            `Tipo de inventario: ${lista(contar(g, (a) => a.inventario))}.`,
            `Cobertura: ${nal ? 'nacional' : lista(contar(g, (a) => a.regiones), 12)}.`,
          ].join('\n');
        }).join('\n\n') + (proveedores.length > 3 ? `\nTambién coinciden: ${proveedores.slice(3, 8).map((p) => p.etiqueta).join(', ')}.` : '');
      },
    },
    {
      type: 'function',
      function: {
        name: 'consultar_producto',
        description: 'Datos de un producto (categoría como "Aceite vegetal comestible" o "Frijoles enlatados"): artículos, proveedores, marcas y rango de costos.',
        parameters: {
          type: 'object',
          properties: { nombre: { type: 'string', description: 'Nombre del producto o clave PROD.' } },
          required: ['nombre'],
        },
      },
      execute: (args) => {
        const q = texto(args.nombre);
        const arts = catalogo();
        const productos = contar(arts.filter((a) => contiene(`${a.producto} ${a.prod}`, q)), (a) => a.prod, (a) => a.producto);
        if (!q || !productos.length) return `No encontré productos que coincidan con «${q}». Prueba con buscar_articulos.`;
        return productos.slice(0, 3).map(({ clave: prod }) => {
          const g = arts.filter((a) => a.prod === prod);
          alEncontrar(filtrarArticulos(g, { orden: 'menor' }));
          return [
            `Producto ${g[0].producto} (PROD. ${prod})`,
            `Artículos: ${nArt(g)}. Costo unitario ${rango(g)}.`,
            `Proveedores: ${lista(contar(g, (a) => a.cve, (a) => a.provCorto))}.`,
            `Marcas: ${lista(contar(g, (a) => a.marca))}.`,
            `Tipo de inventario: ${lista(contar(g, (a) => a.inventario))}.`,
          ].join('\n');
        }).join('\n\n') + (productos.length > 3 ? `\nTambién coinciden: ${productos.slice(3, 8).map((p) => p.etiqueta).join(', ')}.` : '');
      },
    },
    {
      type: 'function',
      function: {
        name: 'resumen_catalogo',
        description: 'Cifras generales del catálogo: total de artículos, proveedores, productos, marcas, tipos de inventario y vigencias.',
        parameters: { type: 'object', properties: {} },
      },
      execute: () => {
        const arts = catalogo();
        const hoy = hoyISO();
        const dias = arts.map((a) => diasVigencia(a, hoy));
        const vencidos = nArt(arts.filter((_, i) => dias[i] !== null && dias[i]! < 0));
        const pronto = nArt(arts.filter((_, i) => dias[i] !== null && dias[i]! >= 0 && dias[i]! <= 30));
        return [
          `Artículos: ${nArt(arts)}. Proveedores: ${new Set(arts.map((a) => a.cve)).size}. Productos: ${new Set(arts.map((a) => a.prod)).size}. Marcas: ${new Set(arts.map((a) => a.marca)).size}.`,
          `Por tipo de inventario: ${lista(contar(arts, (a) => a.inventario), 8)}.`,
          `Productos con más artículos: ${lista(contar(arts, (a) => a.producto))}.`,
          `Vigencia vencida: ${vencidos}. Vencen en 30 días o menos: ${pronto}.`,
        ].join('\n');
      },
    },
  ];
}

// ──────────────────────────────────────────────────────────────
// Búsqueda previa: la app entiende la pregunta y consulta el catálogo; el modelo solo redacta con esos datos
// ──────────────────────────────────────────────────────────────

/** Palabras que no dicen qué buscar (se quitan antes de buscar artículos). */
const VACIAS = new Set(`
  a al algo algun alguna algunas algunos ante cada como con cual cuales cualquier cuando de del desde donde dos e el
  ella ellos en entre es esta estan este esto estos fue ha hay la las le les lo los mas me mi mis muy ni no nos o otra
  otro para pero poco por que quien se segun ser si sin sobre solo son su sus tal tambien te tiene tienen todo todos
  tu tus un una unas uno unos y ya yo usted ustedes nosotros
  dame dime di muestra muestrame mostrar ensena ensename quiero queria quisiera saber conocer busca buscar buscame
  encuentra necesito puedes podrias favor gracias hola oye ver lista listado cuales
  articulo articulos producto productos catalogo precio precios costo costos cuesta cuestan cuanto cuanta cuantos
  cuantas vale valen tenemos tengo hay existe existen vende venden vendemos maneja manejan surte surten ofrece ofrecen
  barato barata baratos baratas economico economica economicos economicas caro cara caros caras mejor peor
  menor mayor mas menos alto alta bajo baja
  oferta ofertas promocion promociones inventario par tipo tipos
  vence vencen vencer vencido vencidos vigencia vigente vigentes caduca caducan pronto proximo proximos proximas dias
  dia mes semana
  region regiones gerencia gerencias zona estado estados unidad unidades
  proveedor proveedores marca marcas empresa empresas
  dato datos interesante interesantes resumen total totales general cifras numero numeros estadistica estadisticas
  importante importantes principal principales mejores popular populares destacado destacados top primeros primeras
  ultimos ultimas nuevo nuevos tres cinco diez algunos varios ejemplo ejemplos opciones info informacion detalle
  detalles favor porfa porfavor sus
  debajo abajo arriba encima hasta maximo maxima minimo minima pesos peso inferior inferiores superior superiores
  compara comparar comparame comparacion comparativa diferencia diferencias versus vs contra conviene convenga
  respecto promedio promedios rango cual cuales excepto salvo quitando exceptuando sea sean distinto distinta
  distintos distintas diferente diferentes otro otra cuenta contar esten estan esta
  ese esa esos esas eso quienes mismo misma mismos mismas aquel aquella aquellos aquellas ellas
`.split(/\s+/).filter(Boolean));

/** Palabras de razones sociales que no identifican a un proveedor. */
const GENERICAS_PROVEEDOR = new Set(`
  comercial comercializadora conservas industrial industrias industria grupo alimentos alimentaria productos marcas
  representaciones distribuidora distribuidores compania corporativo corporacion internacional servicios soluciones
  activos fabrica empresas abarrotes leche para bienestar mexico mexicana mexicano nacional del los las
`.split(/\s+/).filter(Boolean));

/** ¿Aparece la palabra p (o su singular/plural) entre las de la pregunta? */
function aparece(ps: string[], p: string) {
  return ps.some((w) => w === p || w === `${p}s` || w === `${p}es` || p === `${w}s` || p === `${w}es` || (p.length >= 5 && w.startsWith(p)));
}

/** Lo que entiende la app de una pregunta: qué pide y sobre qué (el tema y los filtros). */
export type Intencion = {
  /** Qué se pide: artículos (lo normal), la lista de proveedores, de productos o de marcas, o cifras generales. */
  pide: 'articulos' | 'proveedores' | 'productos' | 'marcas' | 'resumen';
  /** Palabras a buscar en los artículos. */
  clave: string[];
  /** Primera palabra del producto nombrado («aceite»). */
  producto?: string;
  proveedor?: { cve: string; nombre: string };
  marca?: string;
  region?: string;
  inventario?: string;
  orden?: 'menor' | 'mayor';
  vence?: number;
  /** Costo unitario mínimo y máximo («menos de $30», «entre 20 y 50 pesos»). */
  precioMin?: number;
  precioMax?: number;
  /** Lo que no se quiere («galletas que no sean de Cuétara»). */
  excluir?: { marca?: string; proveedor?: { cve: string; nombre: string }; producto?: string };
  /** Pregunta con varios temas («aceites y frijoles», «compara Patrona con Cristal»): uno por parte. */
  partes?: Intencion[];
  comparar?: boolean;
  /** Temas de más que ya no se consultaron (ver MAX_PARTES). */
  omitidos?: number;
};

/** Proveedor o producto con cuántos artículos tiene, para las tarjetas del chat. */
export type Grupo = { clave: string; nombre: string; articulos: number };

export type Consulta = {
  /** Datos del catálogo para el modelo (vacío si la pregunta no trata del catálogo). */
  datos: string;
  /** Tarjetas: artículos, proveedores o productos, según lo que se pidió. */
  articulos: Articulo[];
  proveedores: Grupo[];
  productos: Grupo[];
};

export const tieneTema = (i: Intencion) => !!(i.clave.length || i.producto || i.proveedor || i.marca);
export const tieneFiltros = (i: Intencion) =>
  !!(i.region || i.inventario || i.orden || i.vence !== undefined || i.precioMin !== undefined || i.precioMax !== undefined || i.excluir);

/** Rango de precio de la pregunta: «menos de $30», «hasta 50 pesos», «más de 100», «entre 20 y 40». */
function rangoPrecio(q: string): { precioMin?: number; precioMax?: number } {
  const n = String.raw`\$?\s*(\d+(?:[.,]\d+)?)(?![\d.,]|\s*(?:dias?|ml|g|gr|kg|l|lt|pzas?|piezas?|x)\b)`;
  const num = (s: string) => Number(s.replace(',', '.'));
  const entre = q.match(new RegExp(String.raw`\bentre\s+${n}\s+(?:y|a)\s+${n}`));
  if (entre) return { precioMin: Math.min(num(entre[1]), num(entre[2])), precioMax: Math.max(num(entre[1]), num(entre[2])) };
  const max = q.match(new RegExp(String.raw`\b(?:menos de|menor(?:es)? (?:a|de|que)|por debajo de|debajo de|abajo de|hasta|maximo|no mas de|inferior(?:es)? a)\s+${n}`));
  const min = q.match(new RegExp(String.raw`\b(?:mas de|mayor(?:es)? (?:a|de|que)|por encima de|arriba de|encima de|minimo|desde|superior(?:es)? a)\s+${n}`));
  return { precioMax: max ? num(max[1]) : undefined, precioMin: min ? num(min[1]) : undefined };
}

/** Parte de la pregunta con lo que no se quiere: «que no sean de Cuétara», «excepto Patrona». */
const EXCLUSION = /\b(?:que no sea(?:n)?(?: de)?|excepto|salvo|sin contar|quitando|exceptuando|pero no(?: de)?|no de|distint[oa]s? (?:a|de)|diferentes? (?:a|de))\s+(?:la |el |los |las )?(?:marca |proveedor |empresa )?(.+?)(?=$|[,;?.!]|\s(?:y|en|con|que|de menos|de mas|entre|hasta)\s)/;

/**
 * Entiende la pregunta sin IA: qué pide (artículos, proveedores, productos, marcas o cifras generales) y sobre qué
 * (producto, proveedor, marca, región, oferta, vigencia, orden por costo). Así un modelo pequeño no tiene que
 * decidir qué buscar: solo redacta con datos reales.
 */
export function entender(pregunta: string, arts: Articulo[]): Intencion {
  // Lo que no se quiere («que no sean de Cuétara») se entiende aparte y se quita de la pregunta
  const q = sinAcentos(pregunta);
  const ex = q.match(EXCLUSION);
  if (ex) {
    const fuera = entenderParte(ex[1], arts);
    const excluir = { marca: fuera.marca, proveedor: fuera.proveedor, producto: fuera.marca || fuera.proveedor ? undefined : fuera.producto };
    if (excluir.marca || excluir.proveedor || excluir.producto) return { ...entenderParte(q.replace(ex[0], ' '), arts), excluir };
  }
  return entenderParte(q, arts);
}

function entenderParte(pregunta: string, arts: Articulo[]): Intencion {
  const q = sinAcentos(pregunta);
  const ps = palabras(pregunta);

  // Si dice «barato» y «caro», gana lo que aparece primero
  const iMenor = q.search(/barat|economic|menor (precio|costo)|mas bajo/);
  const iMayor = q.search(/\bcar[oa]s?\b|mayor (precio|costo)|mas alto/);
  const orden = iMenor >= 0 && (iMayor < 0 || iMenor < iMayor) ? 'menor' : iMayor >= 0 ? 'mayor' : undefined;
  const inventario = /\boferta|promocion/.test(q) ? 'Oferta' : /\bpar\b/.test(q) ? 'PAR' : undefined;
  const vence = /venc|vigencia|caduc/.test(q) ? Number(q.match(/(\d+)\s*dias?/)?.[1] ?? 30) : undefined;
  const region = SIGLAS.find((s) => aparece(ps, sinAcentos(s)) && s.length > 2)
    ?? SIGLAS.find((s) => [REGIONES[s].nombre, ...REGIONES[s].estados, ...REGIONES[s].unidades].some((l) => q.includes(sinAcentos(l))));
  const usadas = new Set<string>();
  if (region) for (const l of [region, REGIONES[region].nombre, ...REGIONES[region].estados]) palabras(l).forEach((w) => usadas.add(w));

  // Proveedor: el que más palabras propias de su nombre comparte con la pregunta. No cuentan las que también son
  // de un producto o de una región: «aceites» es el producto, no «Aceites Grasas y Derivados»; «Sureste» es la
  // región, no «Hari Masa del Sureste»
  const comunes = [...new Set([
    ...arts.flatMap((a) => palabras(a.producto)),
    ...SIGLAS.flatMap((s) => [REGIONES[s].nombre, ...REGIONES[s].estados].flatMap((l) => palabras(l))),
  ])];
  let proveedor: { cve: string; nombre: string; puntos: number } | undefined;
  for (const c of contar(arts, (a) => a.cve, (a) => a.provCorto)) {
    const propias = palabras(c.etiqueta).filter((w) => w.length >= 4 && !GENERICAS_PROVEEDOR.has(w) && !aparece(comunes, w));
    const puntos = propias.filter((w) => aparece(ps, w)).length;
    if (puntos && (!proveedor || puntos > proveedor.puntos)) proveedor = { cve: c.clave, nombre: c.etiqueta, puntos };
  }
  if (proveedor) palabras(proveedor.nombre).forEach((w) => usadas.add(w));

  // Marca: el nombre completo aparece en la pregunta
  const marca = [...new Set(arts.map((a) => a.marca))]
    .filter((m) => m.length >= 4)
    .sort((x, y) => y.length - x.length)
    .find((m) => new RegExp(`(^|\\s)${sinAcentos(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(ps.join(' ')));
  if (marca) palabras(marca).forEach((w) => usadas.add(w));

  const clave = ps.filter((w) => !VACIAS.has(w) && !usadas.has(w) && !/^\d+([.,]\d+)?$/.test(w) && w.length > 1);
  // Producto: la primera palabra de su nombre está en la pregunta («aceites» → Aceite vegetal comestible)
  const producto = clave
    .map((w) => arts.map((a) => palabras(a.producto)[0] ?? '').find((p) => p && aparece([w], p)))
    .find(Boolean);

  const i: Intencion = {
    pide: 'articulos', clave, producto, marca, region, inventario, orden, vence, ...rangoPrecio(q),
    proveedor: proveedor && { cve: proveedor.cve, nombre: proveedor.nombre },
  };
  // Qué pide: «¿quién vende…?» y «proveedores» → proveedores; «marcas» → marcas; «productos» → productos.
  // «¿Cuántos productos tenemos?» o «un dato interesante», sin tema ni filtros, son cifras generales
  // «de ese proveedor», «de esa marca» señalan algo ya dicho, no piden la lista
  const sinReferencias = q.replace(/\b(de |del )?(ese|este|el mismo|dicho|su|esa|esta|la misma)\s+(proveedor|empresa|marca|producto)\b/g, '');
  if (/\bproveedor(es)?\b|\bempresas?\b|\bquien(es)?\b.*\b(vende|venden|surte|surten|maneja|manejan|ofrece|ofrecen|trae|traen)\b/.test(sinReferencias)) i.pide = 'proveedores';
  else if (/\bmarcas?\b/.test(sinReferencias)) i.pide = 'marcas';
  else if (/\bproductos?\b|\bcategorias?\b/.test(sinReferencias)) i.pide = 'productos';
  // («¿cuántos proveedores hay?» sí pide la lista de proveedores, con su total)
  if (i.pide === 'articulos' && !tieneTema(i) && !tieneFiltros(i) && /cuant|total|resumen|interesante|general|catalogo|estadistic|cifra/.test(q)) i.pide = 'resumen';
  return i;
}

/** Palabras que señalan que la pregunta sigue con el tema anterior («¿y el más caro?», «¿quién los vende?»). */
// «la», «los»… solo cuentan como pronombre junto a un verbo («¿quién los vende?») o en «el más barato»; como
// artículo («artículos de la región Metropolitana») no señalan nada anterior
const SEGUIMIENTO = new RegExp([
  String.raw`^\s*¿?\s*y\b`,
  String.raw`\b(ese|esa|esos|esas|este|esta|estos|estas|eso|esto|ellos|ellas|mismo|misma|mismos|mismas|otro|otros|otra|otras)\b`,
  String.raw`\b(lo|los|la|las|le|les)\s+(vende|venden|vendes|surte|surten|tiene|tienen|tienes|maneja|manejan|ofrece|ofrecen|trae|traen|hay|consigo|encuentro|compro|pido|ordena|ordenas|muestra|muestras|da|das)\b`,
  String.raw`^\s*¿?\s*(cual(es)?\s+(es|son)\s+)?(el|la|los|las|lo)\s+(mas|menos)\b`,
  // Un verbo sin sujeto al final habla de lo anterior: «Sabormex» → «¿qué vende?», «¿cuántos artículos tiene?»
  String.raw`\b(vende|tiene|maneja|ofrece|surte|trae|cuesta|cuestan)\s*\??\s*$`,
].join('|'));

/**
 * Palabras que abren una búsqueda nueva sobre todo el catálogo: «artículos de la región Metropolitana»,
 * «¿qué proveedores tenemos?», «¿cuántos proveedores hay en Chiapas?».
 */
const GENERAL = /\b(articulos?|productos?|proveedor(es)?|empresas?|marcas?|catalogo|todo|todos|todas|cualquier|general|lista|listado|tenemos|total|cuant[oa]s)\b/;

/**
 * Une la pregunta con la anterior cuando no trae tema propio: «¿Qué aceites hay?» → «¿quién los vende?» busca
 * proveedores de aceite; «¿y en oferta?» repite la búsqueda con ese filtro. También «ese proveedor» o «esa marca».
 */
export function conContexto(actual: Intencion, previa: Intencion | null, pregunta: string): Intencion {
  if (!previa) return actual;
  const q = sinAcentos(pregunta);
  const i: Intencion = { ...actual };
  if (!i.proveedor && previa.proveedor && /\b(ese|este|el mismo|dicho|del mismo)\s+(proveedor|empresa)\b|\bellos\b/.test(q)) i.proveedor = previa.proveedor;
  if (!i.marca && previa.marca && /\b(esa|esta|la misma|de la misma)\s+marca\b/.test(q)) i.marca = previa.marca;
  if (!i.producto && !i.clave.length && previa.clave.length && /\b(ese|este|el mismo)\s+(producto|articulo)\b/.test(q)) {
    i.clave = previa.clave;
    i.producto = previa.producto;
  }
  // «¿Y de La Costeña?» después de «frijoles en oferta»: agrega el proveedor sin perder los frijoles ni la oferta
  if (tieneTema(i) && /^\s*¿?\s*y\b/.test(q)) {
    const nuevoTema = i.clave.length > 0;
    return {
      ...i,
      ...filtrosDe(i, previa),
      clave: nuevoTema ? i.clave : previa.clave,
      producto: nuevoTema ? i.producto : previa.producto,
      proveedor: i.proveedor ?? (nuevoTema ? undefined : previa.proveedor),
      marca: i.marca ?? (nuevoTema ? undefined : previa.marca),
    };
  }
  // Sin tema propio sigue con el anterior si lo señala («¿quién los vende?», «¿y el más caro?») o si solo agrega
  // un filtro («en oferta», «¿quiénes en Chiapas?»). Si dice «artículos», «productos» o «todo» sin señalar nada,
  // es una búsqueda nueva en todo el catálogo
  const senala = SEGUIMIENTO.test(q);
  const sigue = !tieneTema(i) && (senala || (!GENERAL.test(q) && (tieneFiltros(actual) || actual.pide !== 'articulos')))
    && (actual.pide !== 'resumen' || senala);
  if (!sigue) return i;
  const pide = actual.pide === 'resumen' ? 'articulos' : actual.pide;
  const sigueCon = (p: Intencion): Intencion => ({
    ...i, ...filtrosDe(actual, p), pide, clave: p.clave, producto: p.producto, proveedor: p.proveedor, marca: p.marca,
  });
  // Después de una pregunta con varias partes («aceites y frijoles» → «¿y en oferta?»), sigue con todas
  return previa.partes ? { ...sigueCon(previa), partes: previa.partes.map(sigueCon), comparar: previa.comparar } : sigueCon(previa);
}

/** Filtros de la pregunta nueva; los que no trae, de la anterior. */
function filtrosDe(nueva: Intencion, previa: Intencion): Partial<Intencion> {
  return {
    region: nueva.region ?? previa.region,
    inventario: nueva.inventario ?? previa.inventario,
    vence: nueva.vence ?? previa.vence,
    orden: nueva.orden ?? previa.orden,
    precioMin: nueva.precioMin ?? previa.precioMin,
    precioMax: nueva.precioMax ?? previa.precioMax,
    excluir: nueva.excluir ?? previa.excluir,
  };
}

/** Temas por pregunta, como mucho: más ya no caben con sus datos en la memoria del modelo. */
const MAX_PARTES = 6;

/** Palabras que separan los temas de una pregunta compuesta («aceites y frijoles», «Patrona o Cristal»). */
const SEPARADORES = new Set(['y', 'e', 'o', 'u', 'vs', 'versus', 'contra']);
const COMPARAR = /\bcompar|\bdiferencia|\bvs\b|\bversus\b|\bcontra\b|\bconviene|\b(mas|menos) (barat|car|economic)\w*\b.*\bo\b|\bo\b.*\b(mas|menos) (barat|car|economic)|\bmejor\b.*\bo\b/;

/** Nombres con «y», «o» o «con» adentro («Detergentes y Jabones Sasil»): ahí no se parte la pregunta. */
const nombresCompuestos = new WeakMap<Articulo[], string[]>();
function compuestos(arts: Articulo[]) {
  let n = nombresCompuestos.get(arts);
  if (!n) {
    n = [...new Set(arts.flatMap((a) => [a.provCorto, a.marca, a.producto]).map((x) => palabras(x).join(' ')))]
      .filter((x) => /\s(y|e|o|u|con)\s/.test(x));
    nombresCompuestos.set(arts, n);
  }
  return n;
}

/**
 * Entiende la pregunta con su contexto. Si trae varios temas («¿qué aceites hay y quién vende frijoles?»,
 * «compara los aceites Patrona y Cristal») los separa en partes y cada una se consulta por su lado; los filtros
 * de la pregunta («en oferta», «menos de $30») y el producto en común valen para todas.
 */
export function planear(pregunta: string, previa: Intencion | null, arts: Articulo[]): Intencion {
  const q = sinAcentos(pregunta);
  const toda = entender(pregunta, arts);
  const comparar = COMPARAR.test(q);
  const ps = q.replace(/[,;]/g, ' , ').split(/\s+/).filter(Boolean);
  const nombres = compuestos(arts);
  const pedazos: string[][] = [[]];
  ps.forEach((w, k) => {
    const limpio = palabras(w).join(' ');
    const [antes, despues] = [palabras(ps[k - 1] ?? '').join(' '), palabras(ps[k + 1] ?? '').join(' ')];
    const separa = w === ',' || ((SEPARADORES.has(limpio) || (comparar && limpio === 'con'))
      // No dentro de un nombre ni de un rango de precio («entre 20 y 50»)
      && !nombres.some((n) => n.includes(`${antes} ${limpio} ${despues}`))
      && !(/^\d/.test(antes) && /^\d/.test(despues)));
    if (separa) pedazos.push([]);
    else pedazos[pedazos.length - 1].push(w);
  });
  const segmentos = pedazos.map((p) => p.join(' ')).filter((p) => p.trim());
  const intenciones = segmentos.map((s) => entender(s, arts));
  const conTema = intenciones.filter(tieneTema);
  const partes = conTema.slice(0, MAX_PARTES);
  if (partes.length < 2) return conContexto(toda, previa, pregunta);

  // Lo que pide una parte sin tema («…, ¿quién los vende?») vale para todas; si no, lo que pide una parte vale
  // también para las que le siguen («¿quién vende aceite y frijol?»)
  const pideComun = intenciones.find((i) => !tieneTema(i) && i.pide !== 'articulos' && i.pide !== 'resumen')?.pide;
  const conProducto = partes.find((p) => p.clave.length || p.producto);
  let pide: Intencion['pide'] = 'articulos';
  const unidas = partes.map((p): Intencion => {
    if (p.pide !== 'articulos' && p.pide !== 'resumen') pide = p.pide;
    // «aceites de Patrona y Cristal»: la segunda parte también es de aceites
    const comun = !p.clave.length && !p.producto && conProducto && conProducto !== p
      ? { clave: conProducto.clave.filter((w) => !p.marca || !palabras(p.marca).includes(w)), producto: conProducto.producto }
      : {};
    return { ...p, ...comun, ...filtrosDe(p, toda), pide: pideComun ?? (p.pide === 'resumen' ? 'articulos' : p.pide !== 'articulos' ? p.pide : pide) };
  });
  return { ...toda, pide: unidas[0].pide, partes: unidas, comparar, omitidos: conTema.length - partes.length || undefined };
}

/** Consulta el catálogo según lo que se entendió de la pregunta, con las mismas herramientas. */
/** De más a menos detalle: artículos por parte y si van los resúmenes del producto o proveedor. */
const DETALLE = [
  [8, true], [6, true], [5, true], [4, true], [3, true], [2, true], [3, false], [2, false], [1, false], [0, false],
] as const;

/**
 * Consulta el catálogo y arma los datos para el modelo con todo el detalle que quepa en `presupuesto`
 * (caracteres, ver presupuestoDatos): primero con 8 artículos por tema, y si no cabe, con menos. Las tarjetas
 * siempre traen todo lo encontrado.
 */
export function consultarCatalogo(i: Intencion, arts: Articulo[], presupuesto = Infinity): Consulta {
  // La comparación se calcula una vez, con todos los artículos de cada lado
  const lados = i.partes?.length && i.comparar
    ? comparacion(i.partes, i.partes.map((p) => consultarParte({ ...p, pide: 'articulos' }, arts, 1, false).articulos))
    : '';
  let consulta: Consulta | null = null;
  for (const [limite, resumen] of DETALLE) {
    consulta = armar(i, arts, Math.min(limite, MAX_ARTICULOS), resumen, lados);
    if (consulta.datos.length + lados.length <= presupuesto) break;
  }
  const aviso = i.omitidos
    ? `(La pregunta trae ${i.partes!.length + i.omitidos} temas; aquí están los primeros ${i.partes!.length}. Pide el resto en otra pregunta.)`
    : '';
  // El aviso va primero: si hubiera que recortar, se corta el final
  const datos = [aviso, lados, consulta!.datos].filter(Boolean).join('\n\n');
  // Ni con lo mínimo cabe (muchos temas en un teléfono con poca memoria): se corta en un renglón completo
  return { ...consulta!, datos: datos.length > presupuesto ? recortar(datos, presupuesto) : datos };
}

function recortar(texto: string, max: number) {
  const corte = texto.lastIndexOf('\n', max - 40);
  return `${texto.slice(0, corte > 0 ? corte : max - 40)}\n(Hay más datos en las tarjetas de abajo.)`;
}

function armar(i: Intencion, arts: Articulo[], limite: number, resumen: boolean, lados: string): Consulta {
  if (!i.partes?.length) return consultarParte(i, arts, limite, resumen);
  // (en una comparación, sin los resúmenes: contarían todo el producto, no solo ese lado)
  const resultados = i.partes.map((p) => consultarParte(p, arts, limite, resumen && !lados));
  // En una comparación, después de las cifras de cada lado, sus artículos
  const datos = resultados
    .map((r, k) => `${lados ? 'Detalle de' : `Parte ${k + 1}, sobre`} ${describir(i.partes![k]) || 'el catálogo'}:\n${r.datos || 'Sin datos.'}`)
    .join('\n\n');
  return {
    datos,
    // Las tarjetas se intercalan para que se vean todas las partes
    articulos: unicos(intercalar(resultados.map((r) => r.articulos)), (a) => a.artId),
    proveedores: unicos(intercalar(resultados.map((r) => r.proveedores)), (g) => g.clave).slice(0, 6),
    productos: unicos(intercalar(resultados.map((r) => r.productos)), (g) => g.clave).slice(0, 6),
  };
}

function unicos<T>(xs: T[], clave: (x: T) => string) {
  const vistos = new Set<string>();
  return xs.filter((x) => !vistos.has(clave(x)) && vistos.add(clave(x)));
}

function intercalar<T>(listas: T[][]): T[] {
  const todo: T[] = [];
  for (let k = 0; k < Math.max(0, ...listas.map((l) => l.length)); k++) for (const l of listas) if (k < l.length) todo.push(l[k]);
  return todo;
}

/**
 * Comparación ya resuelta: cifras de cada lado y la conclusión. El modelo solo la cuenta; no tiene que comparar
 * precios, que es donde un modelo pequeño se equivoca.
 */
function comparacion(partes: Intencion[], conjuntos: Articulo[][]) {
  const lados = partes.map((p, k) => {
    const con = conjuntos[k].filter((a): a is Articulo & { costoUnit: number } => a.costoUnit !== null);
    const barato = con.length ? con.reduce((x, y) => (y.costoUnit < x.costoUnit ? y : x)) : null;
    const promedio = con.length ? con.reduce((s, a) => s + a.costoUnit, 0) / con.length : null;
    return { nombre: `«${describir({ ...p, pide: 'articulos', orden: undefined }) || 'catálogo'}»`, n: conjuntos[k].length, barato, promedio };
  });
  const renglones = lados.map((l) => !l.n
    ? `- ${l.nombre}: no hay artículos.`
    : `- ${l.nombre}: ${l.n} ${l.n === 1 ? 'artículo' : 'artículos'}; promedio ${dinero(l.promedio)} por pieza; `
      + (l.barato ? `el más barato es ${l.barato.articulo} (${l.barato.marca}, ${l.barato.presentacion}) a ${dinero(l.barato.costoUnit)}.` : 'sin precio.'));
  const conPrecio = lados.filter((l) => l.barato && l.promedio !== null);
  const conclusion: string[] = [];
  // Si los lados se miden igual (litros o kilos), se comparan por litro o kilo: es lo justo con presentaciones
  // distintas. Si no (uno por piezas, otro por kilo), por pieza y con el aviso
  const unidad = (['litro', 'kilo'] as const).find((u) => conjuntos.every((c) => c.length && c.every((a) => porMedida(a)?.unidad === u)));
  if (unidad) {
    const porLado = lados.map((l, k) => {
      const pms = conjuntos[k].map((a) => ({ a, precio: porMedida(a)!.precio }));
      return { ...l, mejor: pms.reduce((x, y) => (y.precio < x.precio ? y : x)), medio: pms.reduce((s, x) => s + x.precio, 0) / pms.length };
    });
    renglones.splice(0, renglones.length, ...porLado.map((l) =>
      `- ${l.nombre}: ${l.n} ${l.n === 1 ? 'artículo' : 'artículos'}; promedio ${dinero(l.medio)} el ${unidad}; `
      + `el que sale más barato es ${l.mejor.a.articulo} (${l.mejor.a.marca}, ${l.mejor.a.presentacion}) a ${dinero(l.mejor.precio)} el ${unidad} `
      + `(${dinero(l.mejor.a.costoUnit)} por pieza).`));
    const menor = porLado.reduce((x, y) => (y.mejor.precio < x.mejor.precio ? y : x));
    const prom = porLado.reduce((x, y) => (y.medio < x.medio ? y : x));
    conclusion.push(`Comparando por ${unidad}, lo más barato es de ${menor.nombre}: ${menor.mejor.a.articulo} a ${dinero(menor.mejor.precio)} el ${unidad}.`);
    conclusion.push(`En promedio por ${unidad} es más barato ${prom.nombre} (${dinero(prom.medio)} el ${unidad}).`);
  } else if (conPrecio.length >= 2) {
    const menor = conPrecio.reduce((x, y) => (y.barato!.costoUnit < x.barato!.costoUnit ? y : x));
    const prom = conPrecio.reduce((x, y) => (y.promedio! < x.promedio! ? y : x));
    conclusion.push(`El artículo más barato de todos es de ${menor.nombre}: ${menor.barato!.articulo} a ${dinero(menor.barato!.costoUnit)}.`);
    conclusion.push(`En promedio por pieza es más barato ${prom.nombre} (${dinero(prom.promedio)}); se venden en medidas distintas, así que compara también la presentación.`);
  }
  const mas = lados.reduce((x, y) => (y.n > x.n ? y : x));
  if (lados.filter((l) => l.n === mas.n).length === 1) conclusion.push(`${mas.nombre} tiene más artículos (${mas.n}).`);
  return [
    'Comparación:', ...renglones,
    conclusion.length ? `Conclusión: ${conclusion.join(' ')}` : '',
  ].filter(Boolean).join('\n');
}

function excluido(a: Articulo, ex: Intencion['excluir']) {
  if (!ex) return false;
  return a.marca === ex.marca || a.cve === ex.proveedor?.cve || (!!ex.producto && sinAcentos(a.producto).startsWith(ex.producto));
}

function consultarParte(i: Intencion, todos: Articulo[], limite: number, resumen = true): Consulta {
  // Fuera de la consulta lo excluido y lo que sale del rango de precio; y si se nombró un producto con una
  // marca o proveedor («aceites Cristal»), solo ese producto: si no, la búsqueda de la marca trae también su manteca
  // (o que lo diga su nombre: «ATUN DOLORES ENSALADA» está registrado en otro producto, pero es atún)
  const raiz = i.producto?.replace(/e?s$/, '') ?? '';
  const delProducto = (a: Articulo) => !i.producto || !(i.marca || i.proveedor)
    || palabras(a.producto)[0] === i.producto || palabras(a.articulo).some((w) => w.startsWith(raiz));
  const arts = i.excluir || i.precioMin !== undefined || i.precioMax !== undefined || (i.producto && (i.marca || i.proveedor))
    ? todos.filter((a) => !excluido(a, i.excluir) && delProducto(a)
      && (i.precioMin === undefined || (a.costoUnit !== null && a.costoUnit >= i.precioMin))
      && (i.precioMax === undefined || (a.costoUnit !== null && a.costoUnit <= i.precioMax)))
    : todos;
  let ultimos: Articulo[] = [];
  const [buscar, proveedorH, productoH, resumenH] = crearHerramientas(() => arts, (a) => {
    ultimos = a;
  }, () => todos);
  const vacia: Consulta = { datos: '', articulos: [], proveedores: [], productos: [] };
  if (i.pide === 'resumen') return { ...vacia, datos: resumenH.execute({}) };

  const filtros = { inventario: i.inventario, region: i.region, orden: i.orden, vence_en_dias: i.vence, proveedor: i.proveedor?.nombre, limite };
  const hayFiltros = arts !== todos || Object.entries(filtros).some(([k, v]) => k !== 'limite' && v !== undefined);
  const texto = [i.marca, ...i.clave].filter(Boolean).join(' ');

  // Artículos del tema; si con todas las palabras no hay nada, con cada una, y luego solo con marca y filtros
  let busqueda = '';
  let subconjunto: Articulo[] | null = null;
  if (texto || hayFiltros) {
    const sinNada = (r: string) => r.startsWith('No se encontraron');
    busqueda = buscar.execute({ ...filtros, texto });
    for (const w of i.clave) {
      if (!sinNada(busqueda)) break;
      busqueda = buscar.execute({ ...filtros, texto: [i.marca, w].filter(Boolean).join(' ') });
    }
    // (solo si queda una marca o un proveedor: con solo filtros saldría todo, p. ej. todas las ofertas, y no el tema)
    if (sinNada(busqueda) && i.clave.length && (i.marca || i.proveedor)) busqueda = buscar.execute({ ...filtros, texto: i.marca ?? '' });
    subconjunto = ultimos;
  }

  const tema = [
    texto && `«${texto}»`,
    i.proveedor && !texto && `de ${i.proveedor.nombre}`,
    i.region && `en la región ${REGIONES[i.region].nombre}`,
    i.inventario && `en ${i.inventario}`,
    i.vence !== undefined && `que vencen en ${i.vence} días o menos`,
    textoPrecio(i),
    i.excluir && `sin ${nombreExcluido(i.excluir)}`,
  ].filter(Boolean).join(' ');

  if (i.pide === 'proveedores' || i.pide === 'productos' || i.pide === 'marcas') {
    const base = subconjunto ?? arts;
    if (!base.length) return { ...vacia, datos: `No encontré artículos ${tema}.` };
    const deGrupo = (a: Articulo) => (i.pide === 'proveedores' ? a.cve : i.pide === 'productos' ? a.prod : a.marca);
    const grupos = i.pide === 'proveedores'
      ? contar(base, (a) => a.cve, (a) => a.provCorto)
      : i.pide === 'productos' ? contar(base, (a) => a.prod, (a) => a.producto) : contar(base, (a) => a.marca);
    // «¿Cuál es el proveedor más barato de atún?»: por su artículo más barato (o el más caro), no por cantidad
    if (i.orden) {
      const extremo = new Map(grupos.map((g) => {
        const costos = base.filter((a) => deGrupo(a) === g.clave && a.costoUnit !== null).map((a) => a.costoUnit!);
        return [g.clave, costos.length ? (i.orden === 'menor' ? Math.min(...costos) : Math.max(...costos)) : null];
      }));
      const valor = (c: string) => extremo.get(c) ?? (i.orden === 'menor' ? Infinity : -Infinity);
      grupos.sort((x, y) => (i.orden === 'menor' ? valor(x.clave) - valor(y.clave) : valor(y.clave) - valor(x.clave)));
    }
    const nombre = { proveedores: 'proveedores', productos: 'productos', marcas: 'marcas' }[i.pide];
    const filas = limite >= MAX_ARTICULOS ? 12 : limite + 4;
    const renglones = grupos.slice(0, filas).map((g) => {
      const suyos = base.filter((a) => deGrupo(a) === g.clave);
      const id = i.pide === 'proveedores' ? ` (CVE ${g.clave})` : i.pide === 'productos' ? ` (PROD. ${g.clave})` : '';
      return `- ${g.etiqueta}${id}: ${g.valor} ${g.valor === 1 ? 'artículo' : 'artículos'}, costo unitario ${rango(suyos)}`;
    });
    // Si el proveedor quedó claro («datos de La Costeña»), también su resumen completo
    const extra = resumen && i.pide === 'proveedores' && grupos.length === 1 && i.proveedor ? proveedorH.execute({ nombre: i.proveedor.nombre }) : '';
    const datos = [
      `${grupos.length} ${grupos.length === 1 ? nombre.replace(/e?s$/, '') : nombre}${tema ? ` con artículos ${tema}` : ' en el catálogo'}${i.orden ? `, ordenados del de precio ${i.orden === 'menor' ? 'más bajo al más alto' : 'más alto al más bajo'}` : ''}${grupos.length > filas ? `; estos son los primeros ${filas}` : ''}:`,
      ...renglones,
      extra,
    ].filter(Boolean).join('\n');
    const tarjetas = grupos.slice(0, 8).map((g) => ({ clave: g.clave, nombre: g.etiqueta, articulos: g.valor }));
    return {
      ...vacia,
      datos,
      // Si se nombró al proveedor («¿qué productos vende Cuétara?»), también su tarjeta
      proveedores: i.pide === 'proveedores' ? tarjetas : i.proveedor ? tarjetasProveedores(base, i.proveedor.cve) : [],
      productos: i.pide === 'productos' ? tarjetas : [],
      articulos: i.pide === 'marcas' ? filtrarArticulos(base, {}) : [],
    };
  }

  // Artículos: resumen del proveedor o del producto nombrado, y la búsqueda
  const partes: string[] = [];
  let tarjetas: Articulo[] = subconjunto ?? [];
  // Con filtros (oferta, región, precio…) el resumen contaría todo el producto y confundiría al modelo: basta la
  // búsqueda, que ya trae el total filtrado
  const acotada = !resumen || (!!busqueda && (arts !== todos || !!i.region || !!i.inventario || i.vence !== undefined));
  if (!acotada && i.proveedor) {
    partes.push(proveedorH.execute({ nombre: i.proveedor.nombre }));
    if (!subconjunto) tarjetas = ultimos;
  } else if (!acotada && i.producto) {
    partes.push(productoH.execute({ nombre: i.producto }));
    if (!subconjunto) tarjetas = ultimos;
  }
  if (busqueda) partes.push(busqueda);
  const vistos = new Set<string>();
  const articulos = tarjetas.filter((a) => !vistos.has(a.artId) && vistos.add(a.artId));
  // Bajo los artículos, quién los vende: el proveedor nombrado o los que más artículos tienen de lo encontrado
  // (el nombrado sale aunque la búsqueda no encuentre nada)
  return { ...vacia, datos: partes.join('\n\n'), articulos, proveedores: tarjetasProveedores(i.proveedor ? arts : articulos, i.proveedor?.cve) };
}

function textoPrecio(i: Intencion) {
  if (i.precioMin !== undefined && i.precioMax !== undefined) return `de ${dinero(i.precioMin)} a ${dinero(i.precioMax)}`;
  if (i.precioMax !== undefined) return `de ${dinero(i.precioMax)} o menos`;
  if (i.precioMin !== undefined) return `de ${dinero(i.precioMin)} o más`;
  return '';
}

const nombreExcluido = (ex: NonNullable<Intencion['excluir']>) => ex.marca ?? ex.proveedor?.nombre ?? ex.producto ?? '';

/** Tarjetas de proveedores de unos artículos: solo el indicado, o los 3 con más artículos. */
function tarjetasProveedores(arts: Articulo[], cve?: string): Grupo[] {
  const grupos = contar(arts, (a) => a.cve, (a) => a.provCorto).map((g) => ({ clave: g.clave, nombre: g.etiqueta, articulos: g.valor }));
  return cve ? grupos.filter((g) => g.clave === cve) : grupos.slice(0, 3);
}

/** Lo que se buscó en palabras («Proveedores · vinagre · región Metropolitana»); vacío si fue una pregunta general. */
export function describir(i: Intencion): string {
  if (i.partes?.length) return i.partes.map((p) => describir(p)).join(i.comparar ? '  vs  ' : '  +  ');
  if (i.pide === 'resumen') return '';
  const partes = [
    { proveedores: 'Proveedores', productos: 'Productos', marcas: 'Marcas', articulos: '' }[i.pide],
    [...i.clave, i.marca].filter(Boolean).join(' '),
    i.proveedor && `de ${i.proveedor.nombre}`,
    i.region && `región ${REGIONES[i.region].nombre}`,
    i.inventario === 'Oferta' ? 'en oferta' : i.inventario && `inventario ${i.inventario}`,
    i.vence !== undefined && `vencen en ${i.vence} días o menos`,
    textoPrecio(i),
    i.excluir && `sin ${nombreExcluido(i.excluir)}`,
    i.orden && (i.orden === 'menor' ? 'más baratos primero' : 'más caros primero'),
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : '';
}

/** Mensaje para el modelo: los datos consultados y la pregunta. */
export function mensajeConDatos(pregunta: string, datos: string) {
  return datos
    ? `Datos del catálogo:\n${datos}\n\nPregunta: ${pregunta}\n\nResponde usando solo estos datos, en frases sencillas y sin copiar las claves.`
    : `Pregunta: ${pregunta}\n\n(No hay datos del catálogo para esta pregunta.)`;
}

const SIN_DATOS = 'No encontré datos del catálogo para responder eso. Pregunta por un artículo, producto, marca o proveedor; por ejemplo: «¿qué aceites hay?».';

/**
 * Red de seguridad para un modelo pequeño, que a veces responde de memoria: los precios y claves ART. de la
 * respuesta tienen que estar en los datos consultados.
 * - Si no hubo datos y aun así da cifras, la respuesta se descarta (serían inventadas).
 * - Si menciona un precio o una clave que no está en lo consultado, se muestra con una advertencia.
 */
export function revisarRespuesta(original: string, datos: string): { texto: string; aviso?: string } {
  const respuesta = pulir(original);
  // Un modelo pequeño a veces se pasa a otro idioma (Qwen, al chino) o se queda repitiendo: mejor no mostrarlo
  if (/[぀-ヿ一-鿿가-힯]/.test(respuesta) || !respuesta) {
    return { texto: datos ? 'No pude redactar bien la respuesta; revisa los artículos de abajo o pregunta de otra forma.' : SIN_DATOS };
  }
  const cifras = respuesta.match(/\$?\s?\d[\d,]*\.\d{2}|ART\.?\s*\d+/gi) ?? [];
  if (!datos) return cifras.length || /\$\s?\d/.test(respuesta) ? { texto: SIN_DATOS } : { texto: respuesta };
  const consultado = datos.replace(/,/g, '');
  const dudosas = cifras.filter((c) => {
    const n = c.replace(/[$,\s]/g, '').replace(/^ART\.?/i, '');
    return !consultado.includes(/^\d+$/.test(n) ? `ART. ${n}` : n);
  });
  return dudosas.length
    ? { texto: respuesta, aviso: 'Algunos datos de esta respuesta no coinciden con el catálogo; confirma en las tarjetas de abajo.' }
    : { texto: respuesta };
}

/** Quita prefijos como «Respuesta:» y las líneas repetidas seguidas (los modelos pequeños a veces se ciclan). */
function pulir(texto: string) {
  const lineas = texto
    .replace(/^\s*(respuesta|asistente)\s*:\s*/i, '')
    // Claves internas que el modelo a veces copia: para el usuario no dicen nada (están en las tarjetas)
    .replace(/\s*\(?\b(ART|CVE|PROD)\.?\s*\d+\)?/g, '')
    .replace(/\bc\/u\b/gi, 'por pieza')
    .split('\n');
  return lineas.filter((l, i) => !l.trim() || l.trim() !== lineas[i - 1]?.trim()).join('\n').trim();
}

/** Texto para mostrar: sin el bloque de razonamiento ni marcas del modelo. */
export function limpiarRespuesta(salida: string) {
  return salida
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}
