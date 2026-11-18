import { NativeTabs } from 'expo-router/native-tabs';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  // Mismo aspecto que en iPhone: sin la «píldora» de Material detrás del ícono, nombres siempre visibles y la
  // pestaña activa en guinda con las demás en gris (en iOS estas opciones de Android no tienen efecto)
  return (
    <NativeTabs
      backgroundColor={colors.backgroundElement}
      disableIndicator
      labelVisibilityMode="labeled"
      rippleColor={colors.accentSoft}
      tintColor={colors.accent}
      iconColor={{ default: colors.muted, selected: colors.accent }}
      labelStyle={{ default: { color: colors.muted }, selected: { color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>INICIO</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="articulos">
        <NativeTabs.Trigger.Label>ARTÍCULOS</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="shippingbox.fill" md="inventory_2" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="productos">
        <NativeTabs.Trigger.Label>PRODUCTOS</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="cart.fill" md="shopping_cart" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="regiones">
        <NativeTabs.Trigger.Label>REGIONES</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map.fill" md="map" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="proveedores">
        <NativeTabs.Trigger.Label>PROVEEDORES</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="building.2.fill" md="storefront" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
