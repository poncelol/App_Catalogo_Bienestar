import { Image } from 'expo-image';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type TextStyle, type ViewStyle } from 'react-native';

import { Icono, s as ui, type ICONOS } from '@/components/abasto/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { diasVigencia, dinero, entero, type Articulo } from '@/data/abasto';
import { palabras, resaltar } from '@/data/busqueda';
import { GRANDE, imagenProducto, MINIATURA, tamano } from '@/data/imagenes';
import { useTheme } from '@/hooks/use-theme';

const MARGEN = Spacing.three;
const ESPACIO = Spacing.three;

/** Columnas y ancho de cada tarjeta: 2 en teléfono, 3 en pantallas anchas. */
export function useRejilla(margen: number = MARGEN) {
  const { width } = useWindowDimensions();
  const util = Math.min(width, MaxContentWidth) - margen * 2;
  const columnas = util >= 640 ? 3 : 2;
  return { columnas, ancho: Math.floor((util - ESPACIO * (columnas - 1)) / columnas), espacio: ESPACIO };
}

/** Color estable por clave, para que cada producto tenga siempre el mismo tono en los recuadros sin foto. */
function tono(clave: string, colores: string[]) {
  let h = 0;
  for (const c of clave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colores[h % colores.length];
}

/**
 * Foto del artículo o producto; sin foto (o si no carga) muestra un recuadro con ícono del color del producto.
 * En listas se pide en tamaño miniatura; con `grande` (fichas) se muestra primero la miniatura, que ya suele estar
 * en caché, mientras llega la de más resolución.
 */
export function Foto({ uri, clave, icono = 'articulo', style, tamIcono = 36, grande = false }: {
  uri: string | null | undefined;
  clave: string;
  icono?: keyof typeof ICONOS;
  style?: ViewStyle;
  tamIcono?: number;
  grande?: boolean;
}) {
  const t = useTheme();
  // Errores por URL: si después llega otra URL (la del Excel de OneDrive reemplaza a la de la copia guardada) se
  // intenta de nuevo. Al primer error se reintenta con la URL original tal cual, por si la tienda no acepta el
  // cambio de tamaño o fue la red; al segundo, el ícono.
  const [errores, setErrores] = useState<{ uri: string; n: number } | null>(null);
  const n = uri && errores?.uri === uri ? errores.n : 0;
  const color = tono(clave, [t.accent, t.green, t.gold, t.blue]);
  if (uri && n < 2) {
    const fuente = n === 0 ? tamano(uri, grande ? GRANDE : MINIATURA) : uri;
    return (
      <View style={[styles.foto, { backgroundColor: '#ffffff' }, style]}>
        <Image key={n} source={{ uri: fuente }} recyclingKey={fuente} style={StyleSheet.absoluteFill} contentFit="contain"
          placeholder={grande && n === 0 ? { uri: tamano(uri, MINIATURA) } : undefined} placeholderContentFit="contain"
          cachePolicy="memory-disk" transition={grande ? 0 : 120} priority={grande ? 'high' : 'normal'}
          onError={() => setErrores({ uri, n: n + 1 })} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View style={[styles.foto, { backgroundColor: `${color}1F` }, style]}>
      <Icono nombre={icono} color={color} tam={tamIcono} />
    </View>
  );
}

/** Texto con las palabras buscadas resaltadas. */
export function Resaltado({ texto, consulta = '', style, numberOfLines }: {
  texto: string;
  consulta?: string;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
}) {
  const t = useTheme();
  const ps = palabras(consulta);
  if (!ps.length) return <Text style={style} numberOfLines={numberOfLines}>{texto}</Text>;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {resaltar(texto, ps).map((tramo, i) => (
        <Text key={i} style={tramo.on ? { color: t.accent, fontWeight: '700' } : undefined}>{tramo.t}</Text>
      ))}
    </Text>
  );
}

function useAviso(a: Articulo) {
  const t = useTheme();
  const dias = diasVigencia(a);
  return dias === null ? null : dias < 0 ? { texto: 'Vencida', color: t.danger } : dias <= 30 ? { texto: `Vence en ${dias} d`, color: t.gold } : null;
}

/** Renglón de la vista de lista: miniatura, nombre, marca y presentación, proveedor y costo.
 * memo + onPress(a): en listas largas solo se vuelve a dibujar el renglón que cambió. */
export const FilaArticulo = memo(function FilaArticulo({ a, consulta, onPress }: { a: Articulo; consulta?: string; onPress: (a: Articulo) => void }) {
  const t = useTheme();
  const aviso = useAviso(a);
  return (
    <Pressable onPress={() => onPress(a)} style={({ pressed }) => [styles.fila, { backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
      <Foto uri={a.imagen} clave={a.prod} style={styles.miniatura} tamIcono={22} />
      <View style={{ flex: 1, gap: 2 }}>
        <Resaltado texto={a.articulo} consulta={consulta} numberOfLines={2} style={[styles.nombre, { color: t.text }]} />
        <Text style={[styles.presentacion, { color: t.textSecondary }]} numberOfLines={1}>{a.marca} · {a.presentacion}</Text>
        <View style={styles.filaPie}>
          <Text style={[styles.presentacion, { color: t.muted, flexShrink: 1 }]} numberOfLines={1}>{a.provCorto}</Text>
          {a.inventario === 'Oferta' ? <Text style={[styles.insignia, { backgroundColor: t.blue }]}>OFERTA</Text> : null}
          {aviso ? <Text style={[styles.insignia, { backgroundColor: aviso.color }]}>{aviso.texto}</Text> : null}
        </View>
      </View>
      <Text style={[styles.precio, { color: t.accent }]}>{dinero(a.costoUnit)}</Text>
    </Pressable>
  );
});

/** Estado vacío del catálogo con acción opcional. */
export function Vacio({ titulo, texto, accion, onAccion }: { titulo: string; texto?: string; accion?: string; onAccion?: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.vacio}>
      <View style={[styles.vacioIco, { backgroundColor: t.accentSoft }]}>
        <Icono nombre="buscar" color={t.accent} tam={26} />
      </View>
      <Text style={[styles.vacioTitulo, { color: t.text }]}>{titulo}</Text>
      {texto ? <Text style={[styles.vacioTexto, { color: t.muted }]}>{texto}</Text> : null}
      {accion && onAccion ? (
        <Pressable onPress={onAccion} style={({ pressed }) => [styles.vacioBoton, { borderColor: t.accent }, pressed && ui.presionado]}>
          <Text style={{ color: t.accent, fontWeight: '600' }}>{accion}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Tarjetas grises mientras llega el Excel por primera vez. */
export function Esqueleto({ ancho, columnas }: { ancho: number; columnas: number }) {
  const t = useTheme();
  return (
    <View style={[styles.rejilla, { gap: ESPACIO }]}>
      {Array.from({ length: columnas * 3 }, (_, i) => (
        <View key={i} style={[styles.tarjeta, { width: ancho, backgroundColor: t.backgroundElement }]}>
          <View style={[styles.foto, { backgroundColor: t.backgroundSelected }]} />
          <View style={[styles.cuerpo, { gap: 6 }]}>
            <View style={[styles.linea, { width: '40%', backgroundColor: t.backgroundSelected }]} />
            <View style={[styles.linea, { width: '90%', backgroundColor: t.backgroundSelected }]} />
            <View style={[styles.linea, { width: '55%', height: 16, backgroundColor: t.backgroundSelected }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Tarjeta de catálogo: foto, marca, nombre, presentación y costo unitario. */
export const TarjetaArticulo = memo(function TarjetaArticulo({ a, ancho, consulta, onPress }: {
  a: Articulo; ancho: number; consulta?: string; onPress: (a: Articulo) => void;
}) {
  const t = useTheme();
  const aviso = useAviso(a);
  const oferta = a.inventario === 'Oferta';
  return (
    <Pressable onPress={() => onPress(a)} style={({ pressed }) => [styles.tarjeta, { width: ancho, backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
      <View>
        <Foto uri={a.imagen} clave={a.prod} />
        <View style={styles.insignias}>
          {oferta ? <Text style={[styles.insignia, { backgroundColor: t.blue }]}>OFERTA</Text> : null}
          {aviso ? <Text style={[styles.insignia, { backgroundColor: aviso.color }]}>{aviso.texto}</Text> : null}
        </View>
      </View>
      <View style={styles.cuerpo}>
        <Text style={[styles.marca, { color: t.muted }]} numberOfLines={1}>{a.marca}</Text>
        <Resaltado texto={a.articulo} consulta={consulta} numberOfLines={2} style={[styles.nombre, { color: t.text }]} />
        <Text style={[styles.presentacion, { color: t.textSecondary }]} numberOfLines={1}>{a.presentacion}</Text>
        <View style={styles.precioFila}>
          <Text style={[styles.precio, { color: t.accent }]}>{dinero(a.costoUnit)}</Text>
          <Text style={[styles.cu, { color: t.muted }]}>c/u</Text>
        </View>
      </View>
    </Pressable>
  );
});

/** Cuadrícula de artículos para usar dentro de un ScrollView: muestra unos cuantos y un botón «Ver más». */
export function RejillaArticulos({ articulos, onPress, margen, paso = 20 }: {
  articulos: Articulo[];
  onPress: (a: Articulo) => void;
  /** Margen a cada lado entre el borde de la pantalla y la cuadrícula (para calcular el ancho de las tarjetas). */
  margen?: number;
  paso?: number;
}) {
  const t = useTheme();
  const { ancho, espacio } = useRejilla(margen);
  const [n, setN] = useState(paso);
  return (
    <View style={{ gap: Spacing.three }}>
      <View style={[styles.rejilla, { gap: espacio }]}>
        {articulos.slice(0, n).map((a, i) => (
          <TarjetaArticulo key={`${a.negociacion}-${a.artId}-${i}`} a={a} ancho={ancho} onPress={onPress} />
        ))}
      </View>
      {articulos.length > n ? (
        <Pressable onPress={() => setN(n + paso)} style={({ pressed }) => [styles.mas, { borderColor: t.border }, pressed && ui.presionado]}>
          <Text style={[styles.masTexto, { color: t.accent }]}>Ver más ({entero(articulos.length - n)} restantes)</Text>
        </Pressable>
      ) : null}
      {articulos.length === 0 ? <Text style={{ color: t.muted, textAlign: 'center' }}>Sin artículos.</Text> : null}
    </View>
  );
}

export type ResumenProducto = {
  prod: string;
  nombre: string;
  articulos: number;
  proveedores: number;
  marcas: number;
  min: number | null;
  max: number | null;
  imagen: string | null;
  inventarios: Set<string>;
};

/** Agrupa los artículos por producto (PROD.), de más a menos artículos. */
export function agruparProductos(arts: Articulo[]): ResumenProducto[] {
  const grupos = new Map<string, Articulo[]>();
  for (const a of arts) (grupos.get(a.prod) ?? grupos.set(a.prod, []).get(a.prod)!).push(a);
  return [...grupos]
    .map(([prod, g]) => {
      const costos = g.map((a) => a.costoUnit).filter((c): c is number => c !== null);
      return {
        prod,
        nombre: g[0].producto,
        articulos: new Set(g.map((a) => a.artId)).size,
        proveedores: new Set(g.map((a) => a.cve)).size,
        marcas: new Set(g.map((a) => a.marca)).size,
        min: costos.length ? Math.min(...costos) : null,
        max: costos.length ? Math.max(...costos) : null,
        imagen: imagenProducto(prod, g),
        inventarios: new Set(g.map((a) => a.inventario)),
      };
    })
    .sort((x, y) => y.articulos - x.articulos || x.nombre.localeCompare(y.nombre));
}

/** Tarjeta de producto (categoría del catálogo): foto, nombre, artículos y precio desde. */
export const TarjetaProducto = memo(function TarjetaProducto({ p, ancho, onPress }: {
  p: ResumenProducto; ancho: number; onPress: (p: ResumenProducto) => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onPress(p)} style={({ pressed }) => [styles.tarjeta, { width: ancho, backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
      <Foto uri={p.imagen} clave={p.prod} icono="producto" style={{ aspectRatio: 4 / 3 }} />
      <View style={styles.cuerpo}>
        <Text style={[styles.nombre, { color: t.text }]} numberOfLines={2}>{p.nombre}</Text>
        <Text style={[styles.presentacion, { color: t.textSecondary }]}>
          {entero(p.articulos)} {p.articulos === 1 ? 'artículo' : 'artículos'} · {entero(p.marcas)} {p.marcas === 1 ? 'marca' : 'marcas'}
        </Text>
        {p.min !== null ? (
          <View style={styles.precioFila}>
            <Text style={[styles.cu, { color: t.muted }]}>desde</Text>
            <Text style={[styles.precio, { color: t.accent }]}>{dinero(p.min)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

/** Título de sección del catálogo con acción opcional a la derecha («Ver todo»). */
export function Seccion({ titulo, accion, onAccion, children }: { titulo: string; accion?: string; onAccion?: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.seccionH}>
        <Text style={[styles.seccionTitulo, { color: t.text }]}>{titulo}</Text>
        {accion && onAccion ? (
          <Pressable onPress={onAccion} hitSlop={8}>
            <Text style={[styles.seccionAccion, { color: t.accent }]}>{accion}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  foto: { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tarjeta: { borderRadius: 14, overflow: 'hidden' },
  insignias: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  insignia: { color: '#fff', fontSize: 10, fontWeight: '700', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  cuerpo: { padding: 10, gap: 2 },
  marca: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  nombre: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  presentacion: { fontSize: 12 },
  precioFila: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  precio: { fontSize: 17, fontWeight: '700' },
  cu: { fontSize: 11 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 12, padding: 10 },
  miniatura: { width: 64, height: 64, aspectRatio: undefined, borderRadius: 10 },
  filaPie: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linea: { height: 10, borderRadius: 5 },
  vacio: { alignItems: 'center', paddingVertical: Spacing.six, paddingHorizontal: Spacing.four, gap: Spacing.two },
  vacioIco: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  vacioTitulo: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  vacioTexto: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  vacioBoton: { marginTop: Spacing.two, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  mas: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  masTexto: { fontSize: 14, fontWeight: '600' },
  seccionH: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  seccionTitulo: { fontSize: 18, fontWeight: '700' },
  seccionAccion: { fontSize: 14, fontWeight: '600' },
});
