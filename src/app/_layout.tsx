import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import AppTabs from '@/components/app-tabs';
import { AbastoProvider } from '@/data/abasto-context';
import { TemaProvider } from '@/data/tema';
import { useColorScheme } from '@/hooks/use-color-scheme';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  useEffect(() => {
    // La app no carga fuentes ni imágenes al iniciar: el splash se quita en cuanto se monta el layout
    SplashScreen.hideAsync();
  }, []);

  return (
    <TemaProvider>
      <ConTema />
    </TemaProvider>
  );
}

/** Dentro de TemaProvider, para que la navegación use el tema elegido en la app. */
function ConTema() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AbastoProvider>
        <AppTabs />
      </AbastoProvider>
    </ThemeProvider>
  );
}
