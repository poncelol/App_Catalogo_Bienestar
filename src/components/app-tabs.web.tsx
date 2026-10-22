import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { createContext, useContext } from 'react';
import { Pressable, View, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icono, type ICONOS } from '@/components/abasto/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

/** Por debajo de este ancho (teléfono) la barra ocupa todo el ancho, como en la app; arriba, una píldora flotante. */
const ANCHO_COMPACTO = 700;
const Compacta = createContext(false);

const PESTANAS: { name: string; href: '/' | '/articulos' | '/productos' | '/regiones' | '/proveedores'; texto: string; icono: keyof typeof ICONOS }[] = [
  { name: 'index', href: '/', texto: 'Inicio', icono: 'inicio' },
  { name: 'articulos', href: '/articulos', texto: 'Artículos', icono: 'articulo' },
  { name: 'productos', href: '/productos', texto: 'Productos', icono: 'producto' },
  { name: 'regiones', href: '/regiones', texto: 'Regiones', icono: 'mapa' },
  { name: 'proveedores', href: '/proveedores', texto: 'Proveedores', icono: 'proveedor' },
];

export default function AppTabs() {
  const { width } = useWindowDimensions();
  const compacta = width < ANCHO_COMPACTO;
  return (
    <Compacta.Provider value={compacta}>
      <Tabs>
        <TabSlot style={{ height: '100%' }} />
        <TabList asChild>
          <CustomTabList>
            {PESTANAS.map((p) => (
              <TabTrigger key={p.name} name={p.name} href={p.href} asChild>
                <TabButton icono={p.icono}>{p.texto}</TabButton>
              </TabTrigger>
            ))}
          </CustomTabList>
        </TabList>
      </Tabs>
    </Compacta.Provider>
  );
}

export function TabButton({ children, isFocused, icono, ...props }: TabTriggerSlotProps & { icono: keyof typeof ICONOS }) {
  const t = useTheme();
  const compacta = useContext(Compacta);
  if (compacta) {
    // Como la barra de iPhone: la activa en guinda, las demás en gris, sin fondo detrás del ícono
    const color = isFocused ? t.accent : t.muted;
    return (
      <Pressable {...props} style={({ pressed }) => [styles.tabCompacta, pressed && styles.pressed]}>
        <View style={styles.indicador}>
          <Icono nombre={icono} color={color} tam={24} />
        </View>
        <Text style={[styles.etiqueta, { color }]} numberOfLines={1}>
          {children}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const t = useTheme();
  const compacta = useContext(Compacta);
  const { bottom } = useSafeAreaInsets();
  if (compacta) {
    return (
      <View {...props}
        style={[styles.barraCompacta, { backgroundColor: `${t.backgroundElement}F2`, borderTopColor: t.border, paddingBottom: Math.max(bottom, 6) }]}>
        {props.children}
      </View>
    );
  }
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <ThemedText type="smallBold" style={styles.brandText} numberOfLines={1}>
          Abasto Rural 2026
        </ThemedText>

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  barraCompacta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabCompacta: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  indicador: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  etiqueta: {
    // «Proveedores» debe caber completo en un teléfono de 320 px (64 px por pestaña): sin negrita, la activa se
    // distingue por el color
    fontSize: 10,
    fontWeight: '500',
    maxWidth: '100%',
  },
});
