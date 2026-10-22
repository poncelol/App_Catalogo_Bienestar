import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Foto } from '@/components/abasto/catalogo';
import { Chip, Icono, s as ui } from '@/components/abasto/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { REGIONES, diasVigencia, dinero, fechaLarga, type Articulo } from '@/data/abasto';
import { useAbasto } from '@/data/abasto-context';
import { creditoImagen } from '@/data/imagenes';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  articulo: Articulo | null;
  onClose: () => void;
  onVerProveedor: (a: Articulo) => void;
};

/** Ficha de catálogo de un artículo, en una hoja que sube desde abajo. */
export function ArticuloDetalle({ articulo: a, onClose, onVerProveedor }: Props) {
  const t = useTheme();
  const { datos } = useAbasto();
  if (!a) return null;
  // El mismo ART. puede estar en varias negociaciones (p. ej. PAR y Oferta) con costo y vigencia distintos
  const negociaciones = (datos?.articulos ?? []).filter((x) => x.artId === a.artId);
  const dias = diasVigencia(a);
  const vigencia =
    a.vigencia === null
      ? 'Sin fecha de vigencia'
      : `Vigente al ${fechaLarga(a.vigencia)} · ${dias! < 0 ? `venció hace ${-dias!} días` : dias === 0 ? 'vence hoy' : `faltan ${dias} días`}`;
  const colorVig = dias === null ? t.muted : dias < 0 ? t.danger : dias <= 30 ? t.gold : t.ok;
  const colorInv = a.inventario === 'PAR' ? t.accent : a.inventario === 'Oferta' ? t.blue : t.green;

  const ficha: [string, string][] = [
    ['Producto', a.producto],
    ['Presentación', a.presentacion],
    ['Código de barras', a.codigoBarras || '–'],
    ['Clave del artículo', `ART. ${a.artId}`],
    ['Costo de adquisición (caja)', dinero(a.costoCaja)],
    ['Impuesto', a.impuesto],
    ['Proveedor', a.proveedor],
    ['Clave de proveedor (CVE)', a.cve || '–'],
    ['Negociación', a.negociacion || '–'],
  ];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.hoja, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.cuerpo}>
          <View>
            <Foto uri={a.imagen} clave={a.prod} style={styles.foto} grande />
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Cerrar"
              style={({ pressed }) => [styles.cerrar, { backgroundColor: t.backgroundElement }, pressed && ui.presionado]}>
              <Icono nombre="cerrar" color={t.text} tam={16} />
            </Pressable>
            {creditoImagen(a.imagen) ? (
              <Text style={[styles.credito, { color: t.muted }]}>{creditoImagen(a.imagen)}</Text>
            ) : null}
          </View>

          <View style={styles.encabezado}>
            <Text style={[styles.marca, { color: t.muted }]}>{a.marca}</Text>
            <Text style={[styles.nombre, { color: t.text }]} selectable>{a.articulo}</Text>
            <Text style={[styles.presentacion, { color: t.textSecondary }]}>{a.presentacion}</Text>
            <View style={styles.precioFila}>
              <Text style={[styles.precio, { color: t.accent }]}>{dinero(a.costoUnit)}</Text>
              <Text style={[styles.cu, { color: t.muted }]}>costo unitario</Text>
            </View>
            <View style={styles.chips}>
              <Chip texto={a.inventario} color={colorInv} />
              <Chip texto={a.alcance === 'Nacional' ? 'Cobertura nacional' : `Cobertura ${a.alcance.toLowerCase()}`} />
            </View>
            <Text style={[styles.vigencia, { color: colorVig }]}>{vigencia}</Text>
          </View>

          <View style={[styles.tabla, { backgroundColor: t.backgroundElement }]}>
            {ficha.map(([k, v], i) => (
              <View key={k} style={[styles.fila, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[styles.etq, { color: t.muted }]}>{k}</Text>
                <Text style={[styles.valor, { color: t.text }]} selectable>{v}</Text>
              </View>
            ))}
          </View>

          {negociaciones.length > 1 ? (
            <View style={[styles.tabla, { backgroundColor: t.backgroundElement }]}>
              <Text style={[styles.etq, { color: t.muted, padding: Spacing.three, paddingBottom: 0 }]}>
                En {negociaciones.length} negociaciones
              </Text>
              {negociaciones.map((n, i) => (
                <View key={`${n.negociacion}-${i}`} style={[styles.negociacion, i > 0 && { borderTopColor: t.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.valor, { color: t.text }]}>Negociación {n.negociacion || '–'} · {n.inventario}</Text>
                    <Text style={[styles.cu, { color: t.muted }]}>
                      {n.vigencia ? `Vigencia ${fechaLarga(n.vigencia)}` : 'Sin fecha de vigencia'}
                    </Text>
                  </View>
                  <Text style={[styles.negPrecio, { color: n === a ? t.accent : t.text }]}>{dinero(n.costoUnit)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {a.alcance === 'Regional' ? (
            <View style={[styles.tabla, { backgroundColor: t.backgroundElement, padding: Spacing.three, gap: Spacing.two }]}>
              <Text style={[styles.etq, { color: t.muted }]}>Regiones donde se surte</Text>
              <View style={styles.chips}>
                {a.regiones.map((sig) => <Chip key={sig} texto={`${sig} · ${REGIONES[sig].nombre}`} />)}
              </View>
            </View>
          ) : null}

          <Pressable onPress={() => onVerProveedor(a)}
            style={({ pressed }) => [styles.boton, { backgroundColor: t.accent }, pressed && ui.presionado]}>
            <Text style={styles.botonTexto}>Ver catálogo de {a.provCorto}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hoja: { flex: 1 },
  cuerpo: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  foto: { aspectRatio: undefined, height: 300, borderRadius: 16 },
  cerrar: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  credito: { fontSize: 10, textAlign: 'right', marginTop: 4 },
  encabezado: { gap: 4 },
  marca: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  nombre: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  presentacion: { fontSize: 15 },
  precioFila: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: Spacing.two },
  precio: { fontSize: 28, fontWeight: '800' },
  cu: { fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.two },
  vigencia: { fontSize: 13, fontWeight: '600', marginTop: Spacing.two },
  tabla: { borderRadius: 12, overflow: 'hidden' },
  fila: { paddingHorizontal: Spacing.three, paddingVertical: 10, gap: 2 },
  etq: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  valor: { fontSize: 15 },
  negociacion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  negPrecio: { fontSize: 16, fontWeight: '700' },
  boton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  botonTexto: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
