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
};

export type PropsChat = {
  mensajes: Mensaje[];
  setMensajes: (f: (m: Mensaje[]) => Mensaje[]) => void;
  onVerArticulo: (a: Articulo) => void;
};

/** En qué va el modelo: revisando si ya está descargado, descargando, cargando en memoria, listo o con error. */
export type EstadoMotor =
  | { fase: 'revisando' }
  | { fase: 'descargando'; progreso: number }
  | { fase: 'cargando'; progreso?: number }
  | { fase: 'listo' }
  | { fase: 'error'; tipo: 'descarga' | 'carga' | 'navegador'; detalle: string };

/** Lo que el chat necesita del modelo; cada plataforma lo implementa con su librería (motor-ia). */
export type Motor = {
  estado: EstadoMotor;
  /** Manda el mensaje (pregunta con datos, ver mensajeConDatos); `onCrudo` recibe todo lo escrito hasta el momento. */
  enviar: (mensaje: string, onCrudo: (crudo: string) => void) => Promise<{ texto: string; cancelado: boolean }>;
  detener: () => void;
};

/** Cuántos artículos se le pasan al modelo por consulta: más llenaría su memoria de contexto. */
const MAX_ARTICULOS = 8;

export function instrucciones() {
  return [
    'Eres el asistente del catálogo de artículos del Programa de Abasto Rural 2026 de Alimentación para el Bienestar.',
    'Responde siempre en español, en 1 a 4 frases, claro y amable.',
    'Cada mensaje trae los "Datos del catálogo" consultados para esa pregunta. Usa SOLO esos datos: no inventes artículos, precios ni cantidades.',
    'Si no hay datos, di amablemente que solo puedes ayudar con el catálogo y da un ejemplo de pregunta, como "¿qué aceites hay?".',
    'Los precios son el costo unitario en pesos mexicanos. Al mencionar un artículo di su nombre, marca y precio.',
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

function renglon(a: Articulo) {
  const cobertura = a.alcance === 'Nacional' ? 'nacional' : a.regiones.join(', ') || 'sin cobertura';
  return `- ART. ${a.artId}: ${a.articulo} | ${a.marca} | ${a.presentacion} | ${a.provCorto} | ${dinero(a.costoUnit)} c/u | ${a.inventario} | ${vigencia(a)} | cobertura ${cobertura}`;
}

function rango(arts: Articulo[]) {
  const costos = arts.map((a) => a.costoUnit).filter((c): c is number => c !== null);
  if (!costos.length) return 'sin costo registrado';
  const [min, max] = [Math.min(...costos), Math.max(...costos)];
  return min === max ? dinero(min) : `de ${dinero(min)} a ${dinero(max)}`;
}

const lista = (cs: { etiqueta: string; valor: number }[], n = 5) =>
  cs.slice(0, n).map((c) => `${c.etiqueta} (${c.valor})`).join(', ') + (cs.length > n ? ` y ${cs.length - n} más` : '');

/**
 * Herramientas sobre el catálogo. `catalogo()` se llama en cada consulta para usar siempre los datos más recientes;
 * `alEncontrar` recibe los artículos de cada búsqueda para mostrarlos como tarjetas bajo la respuesta.
 */
export function crearHerramientas(catalogo: () => Articulo[], alEncontrar: (arts: Articulo[]) => void): Herramienta[] {
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
        const dias = numero(args.vence_en_dias);
        const orden = (['relevancia', 'menor', 'mayor', 'nombre'] as const).find((o) => o === texto(args.orden)) as Orden | undefined;
        const hoy = hoyISO();
        const base = catalogo().filter((a) => {
          if (prov && !contiene(`${a.provCorto} ${a.proveedor}`, prov)) return false;
          if (inv && sinAcentos(a.inventario) !== sinAcentos(inv)) return false;
          if (sig && a.alcance !== 'Nacional' && !a.regiones.includes(sig)) return false;
          if (max !== null && (a.costoUnit === null || a.costoUnit > max)) return false;
          if (dias !== null) {
            const d = diasVigencia(a, hoy);
            if (d === null || d < 0 || d > dias) return false;
          }
          return true;
        });
        // Si lo buscado es un producto («aceite», «frijol»), solo ese producto: si no, «aceite» por precio
        // empezaría por el atún en aceite
        const ps = palabras(q);
        const delProducto = (a: Articulo) => ps.every((p) => sinAcentos(a.producto).includes(p.length > 3 ? p.replace(/e?s$/, '') : p));
        const acotado = ps.length && base.some(delProducto) ? base.filter(delProducto) : base;
        const encontrados = filtrarArticulos(acotado, { texto: q || undefined, orden });
        alEncontrar(encontrados);
        if (!encontrados.length) return 'No se encontraron artículos con esos criterios.';
        const resto = encontrados.length - MAX_ARTICULOS;
        return [
          `${encontrados.length} artículos encontrados${resto > 0 ? `; estos son los primeros ${MAX_ARTICULOS}` : ''}:`,
          ...encontrados.slice(0, MAX_ARTICULOS).map(renglon),
        ].join('\n');
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

export type Consulta = {
  /** Datos del catálogo para el modelo (vacío si la pregunta no trata del catálogo). */
  datos: string;
  /** Artículos encontrados, para las tarjetas. */
  articulos: Articulo[];
  /** La pregunta no nombra producto, proveedor, marca ni palabras de búsqueda (p. ej. «¿y el más caro?»). */
  sinTema: boolean;
};

/**
 * Entiende la pregunta sin IA (producto, proveedor, marca, región, oferta, vigencia, orden por costo o cifras
 * generales) y consulta el catálogo con las mismas herramientas. Así un modelo pequeño no tiene que decidir qué
 * buscar: solo redacta con datos reales.
 */
export function consultarCatalogo(pregunta: string, arts: Articulo[]): Consulta {
  const q = sinAcentos(pregunta);
  const ps = palabras(pregunta);
  const encontrados: Articulo[] = [];
  const [buscar, proveedorH, productoH, resumenH] = crearHerramientas(() => arts, (a) => encontrados.push(...a));
  const partes: string[] = [];

  // Si dice «barato» y «caro» (un seguimiento junto a la pregunta anterior), gana lo que aparece primero
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
  const comunes = new Set([
    ...arts.flatMap((a) => palabras(a.producto)),
    ...SIGLAS.flatMap((s) => [REGIONES[s].nombre, ...REGIONES[s].estados].flatMap((l) => palabras(l))),
  ]);
  let proveedor: { cve: string; nombre: string; puntos: number } | null = null;
  for (const c of contar(arts, (a) => a.cve, (a) => a.provCorto)) {
    const propias = palabras(c.etiqueta).filter((w) => w.length >= 4 && !GENERICAS_PROVEEDOR.has(w) && !aparece([...comunes], w));
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

  const clave = ps.filter((w) => !VACIAS.has(w) && !usadas.has(w) && !/^\d+$/.test(w) && w.length > 1);
  // Producto: la primera palabra de su nombre está en la pregunta («aceites» → Aceite vegetal comestible)
  const producto = clave
    .map((w) => arts.map((a) => palabras(a.producto)[0] ?? '').find((p) => p && aparece([w], p)))
    .find(Boolean);

  const filtros = { inventario, region, orden, vence_en_dias: vence, proveedor: proveedor?.nombre };
  const hayFiltros = Object.values(filtros).some((v) => v !== undefined);

  if (proveedor) partes.push(proveedorH.execute({ nombre: proveedor.nombre }));
  if (producto && !proveedor) partes.push(productoH.execute({ nombre: producto }));
  // Las tarjetas son las de la búsqueda (con su orden) si la hubo; si no, las del producto o proveedor
  let desde = 0;
  if (clave.length || marca || hayFiltros) {
    desde = encontrados.length;
    let r = buscar.execute({ ...filtros, texto: [marca, ...clave].filter(Boolean).join(' ') });
    // Si con todas las palabras no hay nada, se intenta con cada una (p. ej. «frijoles para la tienda»)
    for (const w of clave) {
      if (!r.startsWith('No se encontraron')) break;
      r = buscar.execute({ ...filtros, texto: [marca, w].filter(Boolean).join(' ') });
    }
    // Y si aun así no hay nada, solo con la marca, el proveedor y los filtros («los importantes de Cuetara»)
    if (r.startsWith('No se encontraron') && clave.length && (marca || hayFiltros)) {
      r = buscar.execute({ ...filtros, texto: marca ?? '' });
    }
    partes.push(r);
  }
  if (!partes.length && /cuant|total|resumen|catalogo|interesante|general|cifra|estadistic|productos|proveedores|marcas/.test(q)) {
    partes.push(resumenH.execute({}));
  }

  const vistos = new Set<string>();
  return {
    datos: partes.join('\n\n'),
    articulos: (encontrados.length > desde ? encontrados.slice(desde) : encontrados).filter((a) => !vistos.has(a.artId) && vistos.add(a.artId)),
    sinTema: !clave.length && !proveedor && !marca,
  };
}

/** Mensaje para el modelo: los datos consultados y la pregunta. */
export function mensajeConDatos(pregunta: string, datos: string) {
  return datos
    ? `Datos del catálogo:\n${datos}\n\nPregunta: ${pregunta}\n\nResponde usando solo estos datos.`
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
  const lineas = texto.replace(/^\s*(respuesta|asistente)\s*:\s*/i, '').split('\n');
  return lineas.filter((l, i) => !l.trim() || l.trim() !== lineas[i - 1]?.trim()).join('\n').trim();
}

/** Texto para mostrar: sin el bloque de razonamiento ni marcas del modelo. */
export function limpiarRespuesta(salida: string) {
  return salida
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}
