import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing, type Palette } from '@/constants/theme';
import { entero, fechaLarga, hoyISO, isoLocal, type Conteo } from '@/data/abasto';
import { useAbasto } from '@/data/abasto-context';
import { useTheme } from '@/hooks/use-theme';

// Íconos: SF Symbols en iOS y Material Symbols en Android/web
export const ICONOS = {
  inicio: { ios: 'house', android: 'home', web: 'home' },
  temaAuto: { ios: 'circle.lefthalf.filled', android: 'contrast', web: 'contrast' },
  temaClaro: { ios: 'sun.max', android: 'light_mode', web: 'light_mode' },
  temaOscuro: { ios: 'moon', android: 'dark_mode', web: 'dark_mode' },
  proveedor: { ios: 'building.2', android: 'storefront', web: 'storefront' },
  producto: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  articulo: { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' },
  marca: { ios: 'tag', android: 'sell', web: 'sell' },
  buscar: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  cerrar: { ios: 'xmark', android: 'close', web: 'close' },
  alerta: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  sinRed: { ios: 'icloud.slash', android: 'cloud_off', web: 'cloud_off' },
  ok: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  flecha: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  reciente: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  completar: { ios: 'arrow.up.left', android: 'north_west', web: 'north_west' },
  filtros: { ios: 'line.3.horizontal.decrease.circle', android: 'tune', web: 'tune' },
  cuadricula: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' },
  lista: { ios: 'list.bullet', android: 'view_list', web: 'view_list' },
  orden: { ios: 'arrow.up.arrow.down', android: 'swap_vert', web: 'swap_vert' },
  mapa: { ios: 'map', android: 'map', web: 'map' },
  ubicacion: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' },
  // Ilustraciones de productos (ver ilustracion-producto.tsx)
  pAceite: { ios: 'drop', android: 'water_drop', web: 'water_drop' },
  pAgua: { ios: 'waterbottle', android: 'water_full', web: 'water_full' },
  pLeche: { ios: 'cup.and.saucer', android: 'local_drink', web: 'local_drink' },
  pBebe: { ios: 'teddybear', android: 'child_care', web: 'child_care' },
  pCafe: { ios: 'cup.and.heat.waves', android: 'coffee', web: 'coffee' },
  pJugo: { ios: 'takeoutbag.and.cup.and.straw', android: 'emoji_food_beverage', web: 'emoji_food_beverage' },
  pPan: { ios: 'birthday.cake', android: 'bakery_dining', web: 'bakery_dining' },
  pGrano: { ios: 'laurel.leading', android: 'grain', web: 'grain' },
  pPasta: { ios: 'fork.knife', android: 'ramen_dining', web: 'ramen_dining' },
  pPescado: { ios: 'fish', android: 'set_meal', web: 'set_meal' },
  pCarne: { ios: 'fork.knife', android: 'kebab_dining', web: 'kebab_dining' },
  pSalsa: { ios: 'frying.pan', android: 'soup_kitchen', web: 'soup_kitchen' },
  pVerdura: { ios: 'carrot', android: 'nutrition', web: 'nutrition' },
  pDulce: { ios: 'birthday.cake', android: 'cake', web: 'cake' },
  pLavado: { ios: 'washer', android: 'local_laundry_service', web: 'local_laundry_service' },
  pLimpieza: { ios: 'sparkles', android: 'cleaning_services', web: 'cleaning_services' },
  pPlaga: { ios: 'ant', android: 'pest_control', web: 'pest_control' },
  pAseo: { ios: 'hands.sparkles', android: 'soap', web: 'soap' },
  pCabello: { ios: 'shower', android: 'shower', web: 'shower' },
  pDental: { ios: 'mouth', android: 'dentistry', web: 'dentistry' },
  pPapel: { ios: 'scroll', android: 'receipt_long', web: 'receipt_long' },
  pSalud: { ios: 'cross.case', android: 'healing', web: 'healing' },
  pVela: { ios: 'flame', android: 'local_fire_department', web: 'local_fire_department' },
  pFoco: { ios: 'lightbulb', android: 'lightbulb', web: 'lightbulb' },
  pEscolar: { ios: 'backpack', android: 'backpack', web: 'backpack' },
  pBolsa: { ios: 'bag', android: 'shopping_bag', web: 'shopping_bag' },
  pUtensilio: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  pLamina: { ios: 'cube.box', android: 'inventory_2', web: 'inventory_2' },
  pCampo: { ios: 'hammer', android: 'agriculture', web: 'agriculture' },
  pAnimal: { ios: 'pawprint', android: 'pets', web: 'pets' },
} as const satisfies Record<string, SymbolViewProps['name']>;

export function Icono({ nombre, color, tam = 18 }: { nombre: keyof typeof ICONOS; color: string; tam?: number }) {
  return <SymbolView name={ICONOS[nombre]} tintColor={color} size={tam} />;
}

/** Pantalla con desplazamiento, encabezado guinda y «jalar para actualizar». */
export function Pantalla({ titulo, sub, children }: { titulo: string; sub: string; children: ReactNode }) {
  const t = useTheme();
  const { cargando, actualizar } = useAbasto();
  return (
    <View style={[s.fondo, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={actualizar} tintColor={t.accent} colors={[t.accent]} />}>
        <Encabezado titulo={titulo} sub={sub} />
        <View style={s.cuerpo}>
          <EstadoDatos />
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

export function Encabezado({ titulo, sub }: { titulo: string; sub: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.banner }}>
      <SafeAreaView edges={['top']} style={s.banner}>
        <Text style={s.bannerEyebrow}>Alimentación para el Bienestar · Abasto Rural 2026</Text>
        <Text style={s.bannerTitulo}>{titulo}</Text>
        <Text style={s.bannerSub}>{sub}</Text>
      </SafeAreaView>
      <View style={s.bannerFranja} />
    </View>
  );
}

/** Origen de los datos (SharePoint o copia guardada) y error de descarga, si lo hubo. */
export function EstadoDatos() {
  const t = useTheme();
  const { datos, error, cargando } = useAbasto();
  if (!datos && cargando) return <Aviso t={t} color={t.blue} texto="Descargando el Excel de SharePoint…" />;
  const cuando = datos ? momento(new Date(datos.descargado)) : '';
  if (error) {
    return (
      <Aviso
        t={t}
        color={t.danger}
        icono="sinRed"
        texto={datos ? `${error} Muestro la copia guardada (${cuando}).` : `${error} Jala hacia abajo para reintentar.`}
      />
    );
  }
  return datos ? (
    <Text style={[s.estado, { color: t.muted }]}>
      {datos.origen === 'red' ? 'Actualizado de SharePoint' : 'Copia guardada'} {cuando} · jala para actualizar
    </Text>
  ) : null;
}

function momento(d: Date) {
  const dia = isoLocal(d);
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dia === hoyISO() ? 'hoy' : `el ${fechaLarga(dia)}`} a las ${hora}`;
}

function Aviso({ t, color, texto, icono = 'alerta' }: { t: Palette; color: string; texto: string; icono?: keyof typeof ICONOS }) {
  return (
    <View style={[s.aviso, { backgroundColor: t.backgroundElement, borderLeftColor: color }]}>
      <Icono nombre={icono} color={color} tam={16} />
      <Text style={[s.avisoTexto, { color: t.text }]}>{texto}</Text>
    </View>
  );
}

export function Tarjeta({ titulo, sub, extra, children }: { titulo: string; sub?: string; extra?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[s.tarjeta, { backgroundColor: t.backgroundElement }]}>
      <View style={[s.tarjetaH, { borderBottomColor: t.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.tarjetaTitulo, { color: t.text }]}>{titulo}</Text>
          {sub ? <Text style={[s.tarjetaSub, { color: t.muted }]}>{sub}</Text> : null}
        </View>
        {extra ? <Text style={[s.extra, { color: t.accent, backgroundColor: t.accentSoft }]}>{extra}</Text> : null}
      </View>
      <View style={s.tarjetaCuerpo}>{children}</View>
    </View>
  );
}

export function Kpi({ etiqueta, valor, icono, pista, onPress }: {
  etiqueta: string;
  valor: number;
  icono: keyof typeof ICONOS;
  /** Texto pequeño bajo el número (p. ej. «Ver todos»). */
  pista?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [s.kpi, { backgroundColor: t.backgroundElement }, pressed && s.presionado]}>
      <View style={[s.kpiIco, { backgroundColor: t.accentSoft }]}>
        <Icono nombre={icono} color={t.accent} tam={20} />
      </View>
      <Text style={[s.kpiEtiqueta, { color: t.muted }]} numberOfLines={1}>{etiqueta}</Text>
      <Text style={[s.kpiValor, { color: t.text }]}>{entero(valor)}</Text>
      {pista ? <Text style={[s.kpiPista, { color: t.accent }]}>{pista}</Text> : null}
    </Pressable>
  );
}

export function Chip({ texto, activo, color, onPress }: { texto: string; activo?: boolean; color?: string; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        s.chip,
        { borderColor: activo ? t.accent : t.border, backgroundColor: activo ? t.accentSoft : t.backgroundElement },
        pressed && s.presionado,
      ]}>
      {color ? <View style={[s.chipPunto, { backgroundColor: color }]} /> : null}
      <Text style={[s.chipTexto, { color: activo ? t.accent : t.textSecondary }]} numberOfLines={1}>
        {texto}
      </Text>
    </Pressable>
  );
}

/** Barras horizontales; cada renglón se puede tocar. */
export function Barras({ items, total, color, colores, onPress }: {
  items: Conteo[];
  total: number;
  color?: string;
  /** Color por clave; las que no estén usan `color`. */
  colores?: Record<string, string>;
  onPress?: (c: Conteo) => void;
}) {
  const t = useTheme();
  const max = Math.max(...items.map((i) => i.valor), 1);
  return (
    <View style={{ gap: Spacing.two }}>
      {items.map((i) => (
        <Pressable key={i.clave} onPress={onPress ? () => onPress(i) : undefined} style={({ pressed }) => pressed && s.presionado}>
          <View style={s.barraFila}>
            <Text style={[s.barraEtiqueta, { color: t.text }]} numberOfLines={1}>
              {i.etiqueta}
            </Text>
            <Text style={[s.barraValor, { color: t.textSecondary }]}>
              {entero(i.valor)} · {Math.round((i.valor / total) * 100)}%
            </Text>
          </View>
          <View style={[s.barraFondo, { backgroundColor: t.background }]}>
            <View style={[s.barra, { width: `${(i.valor / max) * 100}%`, backgroundColor: colores?.[i.clave] ?? color ?? t.accent }]} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  fondo: { flex: 1 },
  scroll: { paddingBottom: BottomTabInset + Spacing.four },
  cuerpo: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  banner: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  bannerEyebrow: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '500' },
  bannerTitulo: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 4 },
  bannerSub: { color: 'rgba(255,255,255,0.88)', fontSize: 14, marginTop: 4 },
  bannerFranja: { height: 4, backgroundColor: '#CFB579' },
  estado: { fontSize: 12, textAlign: 'center' },
  aviso: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', borderRadius: 10, borderLeftWidth: 4, padding: Spacing.three },
  avisoTexto: { flex: 1, fontSize: 13, lineHeight: 18 },
  tarjeta: { borderRadius: 12, overflow: 'hidden' },
  tarjetaH: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  tarjetaTitulo: { fontSize: 16, fontWeight: '600' },
  tarjetaSub: { fontSize: 12, marginTop: 2 },
  tarjetaCuerpo: { padding: Spacing.three },
  extra: { fontSize: 12, fontWeight: '600', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, overflow: 'hidden' },
  kpi: { flex: 1, minWidth: 0, borderRadius: 12, padding: 12, gap: 2 },
  kpiIco: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  kpiEtiqueta: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValor: { fontSize: 24, fontWeight: '700' },
  kpiPista: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 240 },
  chipPunto: { width: 8, height: 8, borderRadius: 4 },
  chipTexto: { fontSize: 13, fontWeight: '500' },
  presionado: { opacity: 0.6 },
  barraFila: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two, marginBottom: 4 },
  barraEtiqueta: { flex: 1, fontSize: 13, fontWeight: '500' },
  barraValor: { fontSize: 12, fontWeight: '600' },
  barraFondo: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barra: { height: 8, borderRadius: 4 },
});
