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
import { useTheme } from '@/hooks/use-theme';

const DORADO = '#CFB579';

/**
 * Inicio: resumen ejecutivo del catálogo. Cada sección muestra lo esencial, se despliega con «Ver detalle»
 * y lleva a su pestaña para consultar todo.
 */
export default function Inicio() {
  const t = useTheme();
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
    return {
      total: nArt(arts),
      proveedores: contar(arts, (a) => a.cve, (a) => a.provCorto),
      productos: agruparProductos(arts),
      marcas: new Set(arts.map((a) => a.marca)).size,
      // Por tipo de inventario como en el tablero: artículos distintos de cada tipo (un artículo PAR que también tiene
      // una negociación en oferta cuenta en los dos). Se muestran sin porcentajes
      inventario: contar(arts, (a) => a.inventario),
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
  // PAR, Oferta y su combinación con color fijo; los demás tipos, cada uno con un color distinto
  // Mismos colores que el tablero (COLOR_INV)
  const colorInv: Record<string, string> = { PAR: t.accent, Oferta: t.blue, '301': t.green, '75': t.gold };

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
              <PanelCifras
                cifras={[
                  { etiqueta: 'Proveedores', valor: r.proveedores.length, onPress: () => router.navigate('/proveedores') },
                  { etiqueta: 'Productos', valor: r.productos.length, onPress: () => router.navigate('/productos') },
                  { etiqueta: 'Artículos', valor: r.total, onPress: () => verArticulos({}) },
                ]}
                pie={`${entero(r.marcas)} marcas registradas`}
              />

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

              <SeccionResumen
                numero="01"
                titulo="Artículos"
                descripcion="Composición del catálogo por tipo de inventario y estado de vigencia."
                accion="Consultar el catálogo de artículos"
                onAccion={() => verArticulos({})}
                resumen={
                  <>
                    <Dona items={r.inventario} colores={colorInv} otro={t.muted} centro={r.total} />
                    <Leyenda items={r.inventario} total={r.total} colores={colorInv} otro={t.muted} sinPorcentaje
                      onPress={(c) => verArticulos({ inventario: c.clave })} />
                  </>
                }
                detalle={
                  <Tabla filas={[
                    ['Vigentes (más de 30 días)', r.vigentes, t.ok],
                    ['Vencen en 30 días o menos', r.pronto, t.gold],
                    ['Vigencia vencida', r.vencidos, t.danger],
                    ['Sin fecha de vigencia', r.sinFecha, t.muted],
                  ]} total={r.total} titulo="Estado de vigencia" />
                }
              />

              <SeccionResumen
                numero="02"
                titulo="Productos"
                descripcion={`${entero(r.productos.length)} productos agrupan los artículos del catálogo.`}
                accion={`Ver los ${entero(r.productos.length)} productos`}
                onAccion={() => router.navigate('/productos')}
                resumen={<Ranking items={r.productos.slice(0, 3).map((p) => ({ clave: p.prod, etiqueta: p.nombre, valor: p.articulos }))} total={r.total} />}
                detalle={<Ranking items={r.productos.slice(3, 10).map((p) => ({ clave: p.prod, etiqueta: p.nombre, valor: p.articulos }))} total={r.total} desde={4} />}
              />

              <SeccionResumen
                numero="03"
                titulo="Cobertura regional"
                descripcion={`${Object.keys(REGIONES).length} gerencias regionales. Toque una región del mapa para consultarla.`}
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

              <SeccionResumen
                numero="04"
                titulo="Proveedores"
                descripcion={`${entero(r.proveedores.length)} proveedores con artículos vigentes.`}
                accion={`Ver los ${entero(r.proveedores.length)} proveedores`}
                onAccion={() => router.navigate('/proveedores')}
                resumen={<Ranking items={r.proveedores.slice(0, 3)} total={r.total} onPress={(c) => verArticulos({ proveedor: c.clave })} />}
                detalle={<Ranking items={r.proveedores.slice(3, 10)} total={r.total} desde={4} onPress={(c) => verArticulos({ proveedor: c.clave })} />}
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

function EncabezadoInstitucional() {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.banner }}>
      <SafeAreaView edges={['top']} style={styles.encabezado}>
        <View style={styles.institucion}>
          <Image source={require('@/assets/images/emblema-bienestar.png')} style={styles.emblema} contentFit="contain"
            accessibilityLabel="Alimentación para el Bienestar" />
          <View style={styles.separador} />
          {/* Uno debajo del otro: en una sola línea no caben en un teléfono */}
          <View style={styles.institucionTextos}>
            <Text style={styles.gobierno} numberOfLines={1} adjustsFontSizeToFit>GOBIERNO DE <Text style={{ fontWeight: '800' }}>MÉXICO</Text></Text>
            <Text style={styles.dependencia} numberOfLines={2}>Alimentación para el Bienestar</Text>
          </View>
          <View style={{ marginLeft: 'auto' }}>
            <SelectorTema />
          </View>
        </View>
        <Text style={styles.area}>PROGRAMA DE ABASTO RURAL 2026</Text>
        <Text style={styles.titulo}>Subgerencia de Abarrotes</Text>
        <Text style={styles.subtitulo}>Resumen del catálogo de artículos vigentes</Text>
        <Text style={styles.fecha}>Información al {fechaLarga(hoyISO())}</Text>
      </SafeAreaView>
      <View style={styles.franja} />
    </View>
  );
}

/** Cifras generales en un solo panel con divisiones, al estilo de un informe. */
function PanelCifras({ cifras, pie }: { cifras: { etiqueta: string; valor: number; onPress: () => void }[]; pie: string }) {
  const t = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: t.backgroundElement, borderColor: t.border }]}>
      <Text style={[styles.panelTitulo, { color: t.muted }]}>CIFRAS GENERALES</Text>
      <View style={styles.cifras}>
        {cifras.map((c, i) => (
          <Pressable key={c.etiqueta} onPress={c.onPress} accessibilityRole="button" accessibilityLabel={`${c.etiqueta}: ${c.valor}`}
            style={({ pressed }) => [styles.cifra, i > 0 && { borderLeftColor: t.border, borderLeftWidth: StyleSheet.hairlineWidth }, pressed && ui.presionado]}>
            <Text style={[styles.cifraValor, { color: t.text }]}>{entero(c.valor)}</Text>
            <Text style={[styles.cifraEtq, { color: t.textSecondary }]}>{c.etiqueta}</Text>
            <View style={[styles.cifraLinea, { backgroundColor: t.accent }]} />
          </Pressable>
        ))}
      </View>
      <Text style={[styles.panelPie, { color: t.muted, borderTopColor: t.border }]}>{pie}</Text>
    </View>
  );
}

/** Sección numerada con resumen visible y detalle que se despliega en el mismo lugar. */
function SeccionResumen({ numero, titulo, descripcion, resumen, detalle, accion, onAccion }: {
  numero: string;
  titulo: string;
  descripcion: string;
  resumen: ReactNode;
  detalle: ReactNode;
  accion: string;
  onAccion: () => void;
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
        {abierto ? <View style={{ marginTop: Spacing.three }}>{detalle}</View> : null}
      </View>
      <View style={[styles.seccionPie, { borderTopColor: t.border }]}>
        <Pressable onPress={alternar} hitSlop={8} accessibilityState={{ expanded: abierto }}>
          <Text style={[styles.enlace, { color: t.textSecondary }]}>{abierto ? 'Ocultar detalle' : 'Ver detalle'}</Text>
        </Pressable>
        <Pressable onPress={onAccion} hitSlop={8} style={styles.ir}>
          <Text style={[styles.enlace, { color: t.accent }]} numberOfLines={1}>{accion}</Text>
          <Icono nombre="flecha" color={t.accent} tam={13} />
        </Pressable>
      </View>
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
  const minimo = 4 + separacion;
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

function Leyenda({ items, total, colores, otro, onPress, sinPorcentaje = false }: {
  items: Conteo[]; total: number; colores: Record<string, string>; otro: string; onPress: (c: Conteo) => void;
  sinPorcentaje?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={styles.leyenda}>
      {items.map((c) => (
        <Pressable key={c.clave} onPress={() => onPress(c)} style={({ pressed }) => [styles.leyendaItem, pressed && ui.presionado]}>
          <View style={[styles.punto, { backgroundColor: colores[c.clave] ?? otro }]} />
          <Text style={[styles.leyendaTexto, { color: t.text }]}>{c.etiqueta}</Text>
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
function Ranking({ items, total, desde = 1, titulo, onPress }: {
  items: Conteo[]; total: number; desde?: number; titulo?: string; onPress?: (c: Conteo) => void;
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
  gobierno: { color: '#fff', fontSize: 13, fontWeight: '400', letterSpacing: 1 },
  separador: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.4)' },
  dependencia: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  area: { color: DORADO, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  titulo: { color: '#fff', fontSize: 27, fontWeight: '700', marginTop: 4, lineHeight: 32 },
  subtitulo: { color: 'rgba(255,255,255,0.88)', fontSize: 14, marginTop: 4 },
  fecha: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: Spacing.three },
  franja: { height: 4, backgroundColor: DORADO },
  cuerpo: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  buscar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13 },
  buscarTexto: { fontSize: 15, flexShrink: 1 },
  panel: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  panelTitulo: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  cifras: { flexDirection: 'row', paddingVertical: Spacing.three },
  cifra: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  cifraValor: { fontSize: 28, fontWeight: '700' },
  cifraEtq: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  cifraLinea: { width: 20, height: 2, marginTop: 8 },
  panelPie: { fontSize: 12, textAlign: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
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
  leyendaTexto: { flex: 1, fontSize: 14 },
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
