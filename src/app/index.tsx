import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G } from 'react-native-svg';

import { agruparProductos } from '@/components/abasto/catalogo';
import { MapaRegiones } from '@/components/abasto/mapa';
import { SelectorTema } from '@/components/abasto/selector-tema';
import { EstadoDatos, Icono, s as ui } from '@/components/abasto/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { REGIONES, contar, diasVigencia, entero, fechaLarga, hoyISO, nArt, type Articulo, type Conteo } from '@/data/abasto';
import { useAbasto, type FiltrosArticulos } from '@/data/abasto-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const DORADO = '#CFB579';

// Colores de la gráfica de tipo de inventario: guinda, oro, verde y azul de la paleta institucional, ajustados para
// distinguirse entre sí (también con daltonismo) y contra el fondo de cada tema. Los tipos que aparezcan después
// toman los de EXTRAS, siempre en el mismo orden
const INVENTARIO = {
  light: { PAR: '#9b2247', Oferta: '#a57f2c', leche: '#1f8a70', maiz: '#4a6fd0' },
  dark: { PAR: '#d0587f', Oferta: '#ac8836', leche: '#35a08a', maiz: '#6c84e0' },
};
const EXTRAS = ['#7A5C1E', '#B5547A', '#5F6B6D'];

/** Color de cada tipo de inventario. El catálogo los nombra «LECHE BIENESTAR 301» y «MAÍZ P/TODOS 75». */
function coloresInventario(tipos: Conteo[], esquema: 'light' | 'dark') {
  const c = INVENTARIO[esquema];
  let extra = 0;
  return Object.fromEntries(tipos.map(({ clave }) => [clave,
    clave === 'PAR' ? c.PAR : clave === 'Oferta' ? c.Oferta
      : /301/.test(clave) ? c.leche : /\b75\b/.test(clave) ? c.maiz : EXTRAS[extra++ % EXTRAS.length]]));
}

const distintos = <T,>(xs: T[]) => new Set(xs).size;

/** El grupo con más valores distintos (el proveedor con más marcas, el producto con más proveedores…). */
function conMasDistintos(arts: Articulo[], grupo: (a: Articulo) => string, valor: (a: Articulo) => string) {
  const m = new Map<string, Set<string>>();
  for (const a of arts) (m.get(grupo(a)) ?? m.set(grupo(a), new Set()).get(grupo(a))!).add(valor(a));
  return [...m].map(([nombre, v]) => ({ nombre, n: v.size })).sort((x, y) => y.n - x.n || x.nombre.localeCompare(y.nombre))[0];
}

/**
 * Inicio: resumen ejecutivo del catálogo. Cada sección muestra lo esencial, se despliega con «Ver detalle»
 * y lleva a su pestaña para consultar todo.
 */
export default function Inicio() {
  const t = useTheme();
  const esquema = useColorScheme();
  const { datos, cargando, actualizar, setFiltrosArticulos, setRegion, pedirBusqueda } = useAbasto();

  const r = useMemo(() => {
    const arts = datos?.articulos ?? [];
    const hoy = hoyISO();
    // Un artículo puede estar en varias negociaciones con distinta vigencia: cuenta una vez, con la que vence al
    // último (hasta entonces se puede surtir)
    const dias = new Map<string, number | null>();
    for (const a of arts) {
      const d = diasVigencia(a, hoy);
      const previo = dias.get(a.artId);
      dias.set(a.artId, previo === undefined || previo === null ? d : d === null ? previo : Math.max(previo, d));
    }
    const vig = { vencidos: 0, pronto: 0, vigentes: 0, sinFecha: 0 };
    for (const d of dias.values()) vig[d === null ? 'sinFecha' : d < 0 ? 'vencidos' : d <= 30 ? 'pronto' : 'vigentes']++;
    // Para el aviso: artículos con alguna negociación (p. ej. su oferta) que termina pronto, aunque sigan en otra
    const negPronto = new Set(arts.filter((a) => { const d = diasVigencia(a, hoy); return d !== null && d >= 0 && d <= 30; })
      .map((a) => a.artId));
    // Regionales: los que no tienen cobertura nacional en ninguna negociación (así coinciden con «Cobertura regional»)
    const nacionales = new Set(arts.filter((a) => a.alcance === 'Nacional').map((a) => a.artId));
    const regional = arts.filter((a) => a.alcance === 'Regional' && !nacionales.has(a.artId));
    const inventario = contar(arts, (a) => a.inventario);
    const proveedores = contar(arts, (a) => a.cve, (a) => a.provCorto);
    const productos = agruparProductos(arts);
    const marcas = contar(arts, (a) => a.marca);

    // Hojas de negociación por tipo de inventario y cobertura: como en el tablero, PAR arriba y Oferta abajo
    const hojas = (['PAR', 'Oferta'] as const).flatMap((inv) => (['Nacional', 'Regional'] as const).map((alc) => {
      const d = arts.filter((a) => a.inventario === inv && a.alcance === alc);
      return {
        clave: `${inv}-${alc}`, inventario: inv, alcance: alc, hojas: distintos(d.map((a) => a.negociacion)),
        articulos: nArt(d), proveedores: distintos(d.map((a) => a.cve)),
        lista: [...new Set(d.map((a) => `${a.negociacion} · ${a.provCorto}`))].sort(),
      };
    }));

    // Cada proveedor cuenta una vez: con algún artículo nacional va en Nacional, aunque también tenga regionales
    const cveNacional = new Set(arts.filter((a) => a.alcance === 'Nacional').map((a) => a.cve));
    const cveRegional = new Set(arts.filter((a) => a.alcance === 'Regional' && !cveNacional.has(a.cve)).map((a) => a.cve));
    const notasProveedor = Object.fromEntries(proveedores.map(({ clave }) => {
      const suyos = arts.filter((a) => a.cve === clave);
      const tipos = contar(suyos, (a) => a.inventario).map((c) => `${c.etiqueta} ${entero(c.valor)}`).join(' · ');
      return [clave, `${tipos} · ${cveNacional.has(clave) ? 'Nacional' : 'Regional'}`];
    }));
    const detalleInventario = Object.fromEntries(inventario.map(({ clave }) => {
      const suyos = arts.filter((a) => a.inventario === clave);
      const n = distintos(suyos.map((a) => a.negociacion));
      return [clave, `${entero(distintos(suyos.map((a) => a.cve)))} prov. · ${entero(n)} ${n === 1 ? 'hoja' : 'hojas'} neg.`];
    }));
    const provMarcas = conMasDistintos(arts, (a) => a.provCorto, (a) => a.marca);
    const marcaProductos = conMasDistintos(arts, (a) => a.marca, (a) => a.prod);
    const prodProveedores = conMasDistintos(arts, (a) => a.producto, (a) => a.cve);

    return {
      total: nArt(arts),
      proveedores,
      productos,
      ofertas: nArt(arts.filter((a) => { const d = diasVigencia(a, hoy); return a.inventario === 'Oferta' && (d === null || d >= 0); })),
      hojas,
      detalleInventario,
      notasProveedor,
      coberturaProveedores: [
        { clave: 'Nacional', proveedores: cveNacional.size, articulos: nArt(arts.filter((a) => cveNacional.has(a.cve))) },
        { clave: 'Regional', proveedores: cveRegional.size, articulos: nArt(arts.filter((a) => cveRegional.has(a.cve))) },
      ],
      // Texto de cada hallazgo: las posiciones nones van en negritas
      hallazgos: arts.length ? [
        { color: '#9b2247', icono: 'proveedor', partes: ['El proveedor con más artículos es ', proveedores[0].etiqueta, ', con ', entero(proveedores[0].valor), '.'] },
        { color: '#1e5b4f', icono: 'producto', partes: ['El producto con más artículos es ', productos[0].nombre, ', con ', entero(productos[0].articulos), '.'] },
        { color: '#a57f2c', icono: 'marca', partes: ['La marca con más artículos es ', marcas[0].etiqueta, ', con ', entero(marcas[0].valor), '.'] },
        { color: '#002f2a', icono: 'marca', partes: ['', provMarcas.nombre, ' es el proveedor con más marcas: maneja ', entero(provMarcas.n), '.'] },
        { color: '#a57f2c', icono: 'producto', partes: ['', marcaProductos.nombre, ' es la marca con más productos distintos: ', entero(marcaProductos.n), '.'] },
        { color: '#611232', icono: 'estrella', partes: ['', prodProveedores.nombre, ' es el producto con más proveedores: ', entero(prodProveedores.n), ' lo surten.'] },
      ] as const : [],
      // Por tipo de inventario como en el tablero: artículos distintos de cada tipo (un artículo PAR que también tiene
      // una negociación en oferta cuenta en los dos). Se muestran sin porcentajes
      inventario,
      // Cobertura: cada artículo una vez; si tiene cobertura nacional en alguna negociación, cuenta como Nacional
      alcance: contarUnico(arts, (a) => a.alcance, ['Nacional', 'Regional']),
      regiones: contar(regional, (a) => a.regiones).map((c) => ({ ...c, etiqueta: `${c.clave} · ${REGIONES[c.clave].nombre}` })),
      totalRegional: nArt(regional),
      ...vig,
      negPronto: negPronto.size,
    };
  }, [datos]);

  const verArticulos = (f: FiltrosArticulos) => {
    setFiltrosArticulos(f);
    router.navigate('/articulos');
  };
  const colorInv = coloresInventario(r.inventario, esquema);
  const unidades = Object.values(REGIONES).reduce((n, g) => n + g.unidades.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.five }}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={actualizar} tintColor={t.accent} colors={[t.accent]} />}>
        <EncabezadoInstitucional />

        <View style={styles.cuerpo}>
          {/* Parece una caja de texto, pero abre el buscador de Artículos con el teclado listo */}
          <Pressable onPress={() => { pedirBusqueda(); router.navigate('/articulos'); }} accessibilityRole="search"
            style={({ pressed }) => [styles.buscar, { backgroundColor: t.backgroundElement, borderColor: t.border }, pressed && ui.presionado]}>
            <Icono nombre="buscar" color={t.muted} tam={18} />
            <Text style={[styles.buscarTexto, { color: t.muted }]}>Consultar un artículo, marca o código de barras</Text>
          </Pressable>

          <EstadoDatos />

          {datos ? (
            <>
              <BannerCifras cifras={[
                { etiqueta: 'Proveedores', icono: 'proveedor', valor: r.proveedores.length, fondo: '#1e5b4f', onPress: () => router.navigate('/proveedores') },
                { etiqueta: 'Productos', icono: 'producto', valor: r.productos.length, fondo: '#9b2247', onPress: () => router.navigate('/productos') },
                { etiqueta: 'Artículos', icono: 'articulo', valor: r.total, fondo: '#a57f2c', onPress: () => verArticulos({}) },
                { etiqueta: 'Ofertas vigentes', icono: 'estrella', valor: r.ofertas, fondo: '#611232', onPress: () => verArticulos({ inventario: 'Oferta' }) },
              ]} />

              {r.vencidos || r.negPronto ? (
                <View style={[styles.aviso, { backgroundColor: t.backgroundElement, borderColor: t.border, borderLeftColor: t.danger }]}>
                  <Text style={[styles.avisoEtq, { color: t.danger }]}>AVISO DE VIGENCIA</Text>
                  <Text style={[styles.avisoTexto, { color: t.text }]}>
                    {r.vencidos ? `${entero(r.vencidos)} ${r.vencidos === 1 ? 'artículo tiene' : 'artículos tienen'} la vigencia vencida` : ''}
                    {r.vencidos && r.negPronto ? ' y ' : ''}
                    {r.negPronto
                      ? `${entero(r.negPronto)} ${r.negPronto === 1 ? 'artículo tiene una negociación' : 'artículos tienen una negociación'} que vence en los próximos 30 días` +
                        (r.pronto < r.negPronto ? ' (siguen en el catálogo por otra negociación vigente)' : '')
                      : ''}.
                  </Text>
                </View>
              ) : null}

              <SeccionResumen numero="1" titulo="Lectura rápida" descripcion="Lo más importante del programa de un vistazo."
                resumen={<Hallazgos items={r.hallazgos} />} />

              <SeccionResumen numero="2" titulo="Hojas de negociación"
                descripcion="Arriba las hojas PAR y abajo las de Oferta, por cobertura nacional y regional. Toque un recuadro para ver sus hojas."
                resumen={<HojasNegociacion grupos={r.hojas} />} />

              <SeccionResumen numero="3" titulo="Proveedores y cobertura"
                descripcion="Un proveedor con artículos nacionales cuenta solo en Nacional; Regional son los que solo tienen cobertura regional."
                accion={`Ver los ${entero(r.proveedores.length)} proveedores`}
                onAccion={() => router.navigate('/proveedores')}
                textoDetalle={`Mostrar todos (${entero(r.proveedores.length)})`}
                resumen={
                  <>
                    <View style={styles.recuadros}>
                      {r.coberturaProveedores.map((c) => (
                        <View key={c.clave} style={[styles.recuadro, { backgroundColor: t.background, borderLeftColor: c.clave === 'Nacional' ? t.green : t.gold }]}>
                          <Text style={[styles.recuadroEtq, { color: t.textSecondary }]}>Proveedores · Cobertura {c.clave.toLowerCase()}</Text>
                          <Text style={[styles.recuadroValor, { color: t.text }]}>{entero(c.proveedores)}</Text>
                          <Text style={[styles.recuadroSub, { color: t.textSecondary }]}>{entero(c.articulos)} artículos</Text>
                        </View>
                      ))}
                    </View>
                    <Ranking items={r.proveedores.slice(0, 3)} total={r.total} notas={r.notasProveedor} onPress={(c) => verArticulos({ proveedor: c.clave })} />
                  </>
                }
                detalle={<Ranking items={r.proveedores.slice(3)} total={r.total} desde={4} notas={r.notasProveedor} onPress={(c) => verArticulos({ proveedor: c.clave })} />}
              />

              <SeccionResumen numero="4" titulo="Productos y artículos"
                descripcion="Toque un tipo de inventario para ver sus artículos."
                accion="Consultar el catálogo de artículos"
                onAccion={() => verArticulos({})}
                textoDetalle={`Mostrar todos los productos (${entero(r.productos.length)})`}
                resumen={
                  <>
                    <Dona items={r.inventario} colores={colorInv} otro={t.muted} centro={r.total} />
                    <Leyenda items={r.inventario} total={r.total} colores={colorInv} otro={t.muted} sinPorcentaje detalle={r.detalleInventario}
                      onPress={(c) => verArticulos({ inventario: c.clave })} />
                    <Tabla filas={[
                      ['Vigentes (más de 30 días)', r.vigentes, t.ok],
                      ['Vencen en 30 días o menos', r.pronto, t.gold],
                      ['Vigencia vencida', r.vencidos, t.danger],
                      ['Sin fecha de vigencia', r.sinFecha, t.muted],
                    ]} total={r.total} titulo="Estado de vigencia" />
                    <Ranking titulo="Productos con más artículos" items={r.productos.slice(0, 3).map((p) => ({ clave: p.prod, etiqueta: p.nombre, valor: p.articulos }))} total={r.total} />
                  </>
                }
                detalle={<Ranking items={r.productos.slice(3).map((p) => ({ clave: p.prod, etiqueta: p.nombre, valor: p.articulos }))} total={r.total} desde={4} />}
              />

              <SeccionResumen numero="5" titulo="Unidades operativas"
                descripcion={`${Object.keys(REGIONES).length} gerencias regionales y ${unidades} unidades operativas. Toque una región del mapa para consultarla.`}
                accion="Ver regiones y unidades operativas"
                onAccion={() => router.navigate('/regiones')}
                resumen={
                  <>
                    <MapaRegiones seleccion={null} onElegir={(sig) => { setRegion(sig); router.navigate('/regiones'); }} />
                    <Tabla filas={r.alcance.map((c) => [c.clave === 'Nacional' ? 'Cobertura nacional' : `Cobertura ${c.clave.toLowerCase()}`, c.valor,
                      c.clave === 'Nacional' ? t.green : c.clave === 'Regional' ? t.gold : t.muted])} total={r.total} />
                  </>
                }
                detalle={
                  <>
                    <Ranking items={r.regiones} total={r.totalRegional} titulo="Artículos regionales por gerencia" />
                    <Text style={[styles.nota, { color: t.muted }]}>
                      % de los {entero(r.totalRegional)} artículos regionales que llegan a cada gerencia. Un artículo
                      puede llegar a varias, por eso no suman 100 %.
                    </Text>
                  </>
                }
              />
            </>
          ) : null}

          <View style={styles.pie}>
            <View style={[styles.pieLinea, { backgroundColor: DORADO }]} />
            <Text style={[styles.pieTexto, { color: t.muted }]}>Programa de Abasto Rural 2026</Text>
            <Text style={[styles.pieTexto, { color: t.muted }]}>Alimentación para el Bienestar · Gobierno de México</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** Hora local (13:05) de una fecha ISO. */
const hora = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function EncabezadoInstitucional() {
  const t = useTheme();
  const { datos } = useAbasto();
  return (
    <View style={{ backgroundColor: t.banner }}>
      <SafeAreaView edges={['top']} style={styles.encabezado}>
        <View style={styles.institucion}>
          <Image source={require('@/assets/images/emblema-bienestar.png')} style={styles.emblema} contentFit="contain"
            accessibilityLabel="Alimentación para el Bienestar" />
          <View style={styles.separador} />
          {/* Uno debajo del otro: en una sola línea no caben en un teléfono */}
          <View style={styles.institucionTextos}>
            <Text style={styles.gobierno} numberOfLines={2}>Alimentación para el Bienestar</Text>
            <Text style={styles.dependencia} numberOfLines={1}>Dirección Comercial</Text>
          </View>
          <View style={{ marginLeft: 'auto' }}>
            <SelectorTema />
          </View>
        </View>
        <Text style={styles.area}>PROGRAMA DE ABASTO RURAL 2026</Text>
        <Text style={styles.titulo}>Subgerencia de Abarrotes</Text>
        <Text style={styles.subtitulo}>Resumen del catálogo de artículos vigentes · proveedores, productos, marcas y unidades operativas</Text>
        <Text style={styles.fecha}>
          Información al {fechaLarga(hoyISO())}{datos ? ` · ${datos.origen === 'red' ? 'OneDrive' : 'copia guardada'} · ${hora(datos.descargado)}` : ''}
        </Text>
      </SafeAreaView>
      <View style={styles.franja} />
    </View>
  );
}

/** Las cuatro cifras principales del tablero, cada una con su color institucional. */
function BannerCifras({ cifras }: {
  cifras: { etiqueta: string; icono: 'proveedor' | 'producto' | 'articulo' | 'estrella'; valor: number; fondo: string; onPress: () => void }[];
}) {
  return (
    <View style={styles.banner}>
      {cifras.map((c) => {
        // En oro, el texto blanco casi no se lee
        const tinta = c.fondo === '#a57f2c' ? '#002f2a' : '#ffffff';
        return (
          <Pressable key={c.etiqueta} onPress={c.onPress} accessibilityRole="button" accessibilityLabel={`${c.etiqueta}: ${c.valor}`}
            style={({ pressed }) => [styles.bannerCifra, { backgroundColor: c.fondo }, pressed && ui.presionado]}>
            <Icono nombre={c.icono} color={tinta} tam={22} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerEtq, { color: tinta }]} numberOfLines={1}>{c.etiqueta}</Text>
              <Text style={[styles.bannerValor, { color: tinta }]}>{entero(c.valor)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Los hallazgos de «Lectura rápida»: en cada texto, las posiciones nones van en negritas. */
function Hallazgos({ items }: { items: readonly { color: string; icono: 'proveedor' | 'producto' | 'marca' | 'estrella'; partes: readonly string[] }[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      {items.map((h) => (
        <View key={h.partes.join('')} style={[styles.hallazgo, { backgroundColor: t.background }]}>
          <View style={[styles.hallazgoIco, { backgroundColor: h.color }]}>
            <Icono nombre={h.icono} color="#ffffff" tam={15} />
          </View>
          <Text style={[styles.hallazgoTexto, { color: t.text }]}>
            {h.partes.map((p, i) => <Text key={i} style={i % 2 ? { fontWeight: '700' } : undefined}>{p}</Text>)}
          </Text>
        </View>
      ))}
    </View>
  );
}

type GrupoHojas = { clave: string; inventario: string; alcance: string; hojas: number; articulos: number; proveedores: number; lista: string[] };

/** Recuadros de hojas por tipo de inventario y cobertura; al tocar uno se despliegan sus hojas. */
function HojasNegociacion({ grupos }: { grupos: GrupoHojas[] }) {
  const t = useTheme();
  const [abierto, setAbierto] = useState<string | null>(null);
  const elegido = grupos.find((g) => g.clave === abierto);
  const color = (g: GrupoHojas) => (g.inventario === 'PAR' ? (g.alcance === 'Nacional' ? t.accent : t.banner) : g.alcance === 'Nacional' ? t.green : t.gold);
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.recuadros}>
        {grupos.map((g) => (
          <Pressable key={g.clave} onPress={() => setAbierto(abierto === g.clave ? null : g.clave)} accessibilityRole="button"
            accessibilityState={{ expanded: abierto === g.clave }}
            style={({ pressed }) => [styles.recuadro, { backgroundColor: abierto === g.clave ? t.backgroundSelected : t.background, borderLeftColor: color(g) }, pressed && ui.presionado]}>
            <Text style={[styles.recuadroEtq, { color: t.textSecondary }]}>Hojas {g.inventario} · {g.alcance}</Text>
            <Text style={[styles.recuadroValor, { color: t.text }]}>{entero(g.hojas)}</Text>
            <Text style={[styles.recuadroSub, { color: t.textSecondary }]}>{entero(g.articulos)} artículos · {entero(g.proveedores)} proveedores</Text>
          </Pressable>
        ))}
      </View>
      {elegido ? (
        <View style={[styles.hojas, { borderColor: t.border }]}>
          <ScrollView nestedScrollEnabled>
            {elegido.lista.map((h) => <Text key={h} style={[styles.hoja, { color: t.text, borderBottomColor: t.border }]}>{h}</Text>)}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Sección numerada con resumen visible y detalle que se despliega en el mismo lugar. */
function SeccionResumen({ numero, titulo, descripcion, resumen, detalle, accion, onAccion, textoDetalle = 'Ver detalle' }: {
  numero: string;
  titulo: string;
  descripcion: string;
  resumen: ReactNode;
  detalle?: ReactNode;
  accion?: string;
  onAccion?: () => void;
  textoDetalle?: string;
}) {
  const t = useTheme();
  const [abierto, setAbierto] = useState(false);
  const alternar = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAbierto(!abierto);
  };
  return (
    <View style={[styles.seccion, { backgroundColor: t.backgroundElement, borderColor: t.border }]}>
      <View style={styles.seccionH}>
        <Text style={[styles.numero, { color: DORADO }]}>{numero}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.seccionTitulo, { color: t.text }]}>{titulo}</Text>
          <Text style={[styles.seccionDesc, { color: t.textSecondary }]}>{descripcion}</Text>
        </View>
      </View>
      <View style={[styles.regla, { backgroundColor: t.border }]} />
      <View style={styles.seccionCuerpo}>
        {resumen}
        {abierto && detalle ? <View style={{ marginTop: Spacing.three }}>{detalle}</View> : null}
      </View>
      {detalle || accion ? (
        <View style={[styles.seccionPie, { borderTopColor: t.border }]}>
          {detalle ? (
            <Pressable onPress={alternar} hitSlop={8} accessibilityState={{ expanded: abierto }} style={{ flexShrink: 1 }}>
              <Text style={[styles.enlace, { color: t.textSecondary }]}>{abierto ? 'Mostrar menos' : textoDetalle}</Text>
            </Pressable>
          ) : <View />}
          {accion ? (
            <Pressable onPress={onAccion} hitSlop={8} style={styles.ir}>
              <Text style={[styles.enlace, { color: t.accent }]} numberOfLines={1}>{accion}</Text>
              <Icono nombre="flecha" color={t.accent} tam={13} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Gráfica de pastel (dona) con el total al centro, como la del tablero. Cada sector es proporcional a su valor; los muy
 * chicos (p. ej. 1 artículo) se dibujan con un mínimo para que se vean.
 */
function Dona({ items, colores, otro, centro, tam = 176 }: {
  items: Conteo[]; colores: Record<string, string>; otro: string; centro: number; tam?: number;
}) {
  const t = useTheme();
  const grosor = 30;
  const radio = (tam - grosor) / 2;
  const circ = 2 * Math.PI * radio;
  const separacion = items.length > 1 ? 2 : 0;
  const minimo = 12 + separacion;
  const suma = items.reduce((n, c) => n + c.valor, 0) || 1;
  const crudos = items.map((c) => Math.max((c.valor / suma) * circ, minimo));
  const escala = circ / crudos.reduce((n, l) => n + l, 0);
  const largos = crudos.map((l) => l * escala);
  // Dónde empieza cada sector: la suma de los anteriores
  const inicios = largos.map((_, i) => largos.slice(0, i).reduce((n, l) => n + l, 0));
  return (
    <View style={[styles.dona, { width: tam, height: tam }]}>
      <Svg width={tam} height={tam}>
        {/* Empieza arriba (las 12) y avanza en el sentido del reloj */}
        <G rotation={-90} origin={`${tam / 2}, ${tam / 2}`}>
          {items.map((c, i) => (
            <Circle key={c.clave} cx={tam / 2} cy={tam / 2} r={radio} fill="none" stroke={colores[c.clave] ?? otro}
              strokeWidth={grosor} strokeDasharray={`${Math.max(largos[i] - separacion, 0.5)} ${circ}`}
              strokeDashoffset={-inicios[i]} />
          ))}
        </G>
      </Svg>
      <View style={styles.donaCentro} pointerEvents="none">
        <Text style={[styles.donaValor, { color: t.text }]}>{entero(centro)}</Text>
        <Text style={[styles.donaEtq, { color: t.muted }]}>artículos</Text>
      </View>
    </View>
  );
}

function Leyenda({ items, total, colores, otro, onPress, sinPorcentaje = false, detalle }: {
  items: Conteo[]; total: number; colores: Record<string, string>; otro: string; onPress: (c: Conteo) => void;
  sinPorcentaje?: boolean; detalle?: Record<string, string>;
}) {
  const t = useTheme();
  return (
    <View style={styles.leyenda}>
      {items.map((c) => (
        <Pressable key={c.clave} onPress={() => onPress(c)} style={({ pressed }) => [styles.leyendaItem, pressed && ui.presionado]}>
          <View style={[styles.punto, { backgroundColor: colores[c.clave] ?? otro }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.leyendaNombre, { color: t.text }]}>{c.etiqueta}</Text>
            {detalle?.[c.clave] ? <Text style={[styles.recuadroSub, { color: t.textSecondary }]}>{detalle[c.clave]}</Text> : null}
          </View>
          <Text style={[styles.leyendaValor, { color: t.textSecondary }]}>
            {sinPorcentaje ? entero(c.valor) : `${entero(c.valor)} · ${porcentaje(c.valor, total)}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Tabla simple de concepto, cantidad y porcentaje. */
function Tabla({ filas, total, titulo }: { filas: [string, number, string][]; total: number; titulo?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: Spacing.two }}>
      {titulo ? <Text style={[styles.tablaTitulo, { color: t.muted }]}>{titulo.toUpperCase()}</Text> : null}
      {filas.map(([k, v, color], i) => (
        <View key={k} style={[styles.tablaFila, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <View style={[styles.punto, { backgroundColor: color }]} />
          <Text style={[styles.tablaConcepto, { color: t.text }]}>{k}</Text>
          <Text style={[styles.tablaValor, { color: t.text }]}>{entero(v)}</Text>
          <Text style={[styles.tablaPct, { color: t.muted }]}>{porcentaje(v, total)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Lista numerada de los primeros lugares con cantidad y barra de proporción. */
function Ranking({ items, total, desde = 1, titulo, onPress, notas }: {
  items: Conteo[]; total: number; desde?: number; titulo?: string; onPress?: (c: Conteo) => void; notas?: Record<string, string>;
}) {
  const t = useTheme();
  const max = Math.max(...items.map((i) => i.valor), 1);
  return (
    <View>
      {titulo ? <Text style={[styles.tablaTitulo, { color: t.muted }]}>{titulo.toUpperCase()}</Text> : null}
      {items.map((c, i) => (
        <Pressable key={c.clave} onPress={onPress ? () => onPress(c) : undefined} disabled={!onPress}
          style={({ pressed }) => [styles.rank, (i > 0 || desde > 1) && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && ui.presionado]}>
          <Text style={[styles.rankN, { color: t.muted }]}>{desde + i}</Text>
          <View style={{ flex: 1, gap: 5 }}>
            <View style={styles.rankFila}>
              <Text style={[styles.rankNombre, { color: t.text }]} numberOfLines={1}>{c.etiqueta}</Text>
              <Text style={[styles.rankValor, { color: t.text }]}>{entero(c.valor)}</Text>
            </View>
            {notas?.[c.clave] ? <Text style={[styles.recuadroSub, { color: t.textSecondary }]}>{notas[c.clave]}</Text> : null}
            <View style={[styles.rankFondo, { backgroundColor: t.backgroundSelected }]}>
              <View style={[styles.rankBarra, { width: `${(c.valor / max) * 100}%`, backgroundColor: t.accent }]} />
            </View>
          </View>
          <Text style={[styles.tablaPct, { color: t.muted }]}>{porcentaje(c.valor, total)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Artículos distintos por grupo, contando cada artículo una sola vez: si en sus negociaciones tiene varios valores,
 * cuenta en el primero de `prioridad` (los que no están en la lista, después, en orden alfabético).
 */
function contarUnico(arts: Articulo[], valor: (a: Articulo) => string, prioridad: string[]): Conteo[] {
  const rango = (v: string) => (prioridad.includes(v) ? prioridad.indexOf(v) : prioridad.length);
  const elegido = new Map<string, string>();
  for (const a of arts) {
    const v = valor(a);
    const previo = elegido.get(a.artId);
    if (previo === undefined || rango(v) < rango(previo) || (rango(v) === rango(previo) && v < previo)) elegido.set(a.artId, v);
  }
  const n = new Map<string, number>();
  for (const v of elegido.values()) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].map(([clave, v]) => ({ clave, etiqueta: clave, valor: v })).sort((x, y) => y.valor - x.valor);
}

function porcentaje(v: number, total: number) {
  const p = total ? (v / total) * 100 : 0;
  return `${p > 0 && p < 1 ? '<1' : Math.round(p)}%`;
}

const styles = StyleSheet.create({
  encabezado: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  institucion: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.three },
  emblema: { width: 32, height: 34 },
  institucionTextos: { flexShrink: 1, gap: 1 },
  gobierno: { color: '#fff', fontSize: 14, fontWeight: '700' },
  separador: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.4)' },
  dependencia: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  area: { color: DORADO, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  titulo: { color: '#fff', fontSize: 27, fontWeight: '700', marginTop: 4, lineHeight: 32 },
  subtitulo: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 20, marginTop: 4 },
  fecha: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: Spacing.three },
  franja: { height: 4, backgroundColor: DORADO },
  cuerpo: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  buscar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13 },
  buscarTexto: { fontSize: 15, flexShrink: 1 },
  banner: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  bannerCifra: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8, padding: Spacing.three },
  bannerEtq: { fontSize: 12, fontWeight: '600' },
  bannerValor: { fontSize: 26, fontWeight: '700' },
  hallazgo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 8, padding: 10 },
  hallazgoIco: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  hallazgoTexto: { flex: 1, fontSize: 14, lineHeight: 20 },
  recuadros: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  recuadro: { flexBasis: '47%', flexGrow: 1, borderRadius: 8, borderLeftWidth: 4, padding: 12 },
  recuadroEtq: { fontSize: 12, fontWeight: '600' },
  recuadroValor: { fontSize: 24, fontWeight: '700', marginTop: 2 },
  recuadroSub: { fontSize: 12, lineHeight: 16 },
  hojas: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, maxHeight: 260, overflow: 'hidden' },
  hoja: { fontSize: 13, paddingHorizontal: Spacing.three, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  aviso: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 8, padding: Spacing.three, gap: 4 },
  avisoEtq: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  avisoTexto: { fontSize: 14, lineHeight: 20 },
  seccion: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  seccionH: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.three, alignItems: 'flex-start' },
  numero: { fontSize: 26, fontWeight: '300', lineHeight: 30 },
  seccionTitulo: { fontSize: 18, fontWeight: '700' },
  seccionDesc: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  regla: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  seccionCuerpo: { padding: Spacing.three, gap: Spacing.three },
  seccionPie: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  enlace: { fontSize: 13, fontWeight: '600' },
  ir: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  dona: { alignSelf: 'center', marginVertical: Spacing.two },
  donaCentro: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  donaValor: { fontSize: 26, fontWeight: '700' },
  donaEtq: { fontSize: 12 },
  leyenda: { gap: 2 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  leyendaNombre: { fontSize: 14 },
  leyendaValor: { fontSize: 13 },
  nota: { fontSize: 12, lineHeight: 17 },
  punto: { width: 9, height: 9, borderRadius: 2 },
  tablaTitulo: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginBottom: 4 },
  tablaFila: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  tablaConcepto: { flex: 1, fontSize: 14 },
  tablaValor: { fontSize: 14, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  tablaPct: { fontSize: 12, minWidth: 36, textAlign: 'right' },
  rank: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 10 },
  rankN: { fontSize: 13, fontWeight: '700', width: 18, textAlign: 'center' },
  rankFila: { flexDirection: 'row', gap: Spacing.two },
  rankNombre: { flex: 1, fontSize: 14, fontWeight: '500' },
  rankValor: { fontSize: 14, fontWeight: '700' },
  rankFondo: { height: 4, borderRadius: 2, overflow: 'hidden' },
  rankBarra: { height: 4, borderRadius: 2 },
  pie: { alignItems: 'center', gap: 2, marginTop: Spacing.three },
  pieLinea: { width: 40, height: 2, marginBottom: Spacing.two },
  pieTexto: { fontSize: 11, letterSpacing: 0.3 },
});
