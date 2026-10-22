import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme as useSistema } from 'react-native';

/** Apariencia elegida: la del teléfono (automático), o siempre clara u oscura. Se guarda en el teléfono. */
export type Tema = 'auto' | 'claro' | 'oscuro';
const CLAVE = 'tema:v1';

const Contexto = createContext<{ tema: Tema; setTema: (t: Tema) => void; esquema: 'light' | 'dark' }>({
  tema: 'auto',
  setTema: () => undefined,
  esquema: 'light',
});

export function TemaProvider({ children }: { children: ReactNode }) {
  const [tema, setEstado] = useState<Tema>('auto');

  useEffect(() => {
    AsyncStorage.getItem(CLAVE)
      .then((v) => { if (v === 'claro' || v === 'oscuro') setEstado(v); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // En iPhone y Android también cambia lo que dibuja el sistema (barra de pestañas, barra de estado, teclado).
    // En web no existe: ahí basta con el contexto.
    if (Platform.OS !== 'web') Appearance.setColorScheme(tema === 'auto' ? 'unspecified' : tema === 'oscuro' ? 'dark' : 'light');
  }, [tema]);

  const setTema = useCallback((t: Tema) => {
    setEstado(t);
    AsyncStorage.setItem(CLAVE, t).catch(() => undefined);
  }, []);

  // Con un tema fijo en el teléfono, useColorScheme ya devuelve ese tema; en automático, el del sistema
  const sistema = useSistema();
  const esquema = tema === 'auto' ? (sistema === 'dark' ? 'dark' : 'light') : tema === 'oscuro' ? 'dark' : 'light';

  return <Contexto.Provider value={{ tema, setTema, esquema }}>{children}</Contexto.Provider>;
}

export function useTema() {
  return useContext(Contexto);
}
