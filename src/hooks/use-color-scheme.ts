import { useTema } from '@/data/tema';

/** Esquema de color en uso: el del teléfono, o el que se eligió en la app (claro u oscuro). */
export function useColorScheme(): 'light' | 'dark' {
  return useTema().esquema;
}
