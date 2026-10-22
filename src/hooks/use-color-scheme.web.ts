import { useSyncExternalStore } from 'react';

import { useTema } from '@/data/tema';

const nada = () => () => undefined;

/**
 * Esquema de color en uso. La página se genera en el servidor, que no sabe el tema del navegador: ahí se dibuja en
 * claro y, ya en el navegador, con el tema que corresponde.
 */
export function useColorScheme(): 'light' | 'dark' {
  const enNavegador = useSyncExternalStore(nada, () => true, () => false);
  const { esquema } = useTema();
  return enNavegador ? esquema : 'light';
}
