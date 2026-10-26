import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Icono, type ICONOS } from '@/components/abasto/ui';
import { sinAcentos } from '@/data/abasto';

// Tonos de la paleta institucional (Pantone 7420, 7421, 626, 627, 1255, 1255 al 60 % y 7402)
const TONOS = {
  guinda: { fondo: '#9b2247', icono: '#ffffff', franja: '#cfb579' },
  vino: { fondo: '#611232', icono: '#ffffff', franja: '#cfb579' },
  verde: { fondo: '#1e5b4f', icono: '#ffffff', franja: '#cfb579' },
  pino: { fondo: '#002f2a', icono: '#e6d194', franja: '#a57f2c' },
  oro: { fondo: '#a57f2c', icono: '#ffffff', franja: '#611232' },
  arena: { fondo: '#cfb579', icono: '#611232', franja: '#9b2247' },
  crema: { fondo: '#e6d194', icono: '#611232', franja: '#a57f2c' },
} as const;

type Estilo = { icono: keyof typeof ICONOS; tono: keyof typeof TONOS };

/**
 * Ícono y tono de cada producto según su nombre. Gana la primera regla que coincide, por eso van primero las más
 * específicas (p. ej. «leche maternizada» antes que «leche», «manteca de cerdo» antes que «manteca»).
 */
const REGLAS: [RegExp, Estilo][] = [
  [/infantil|biberon|mamila|panal|talco|maternizada|formula/, { icono: 'pBebe', tono: 'arena' }],
  [/cerdo|carne|chilorio/, { icono: 'pCarne', tono: 'vino' }],
  [/aceite|manteca/, { icono: 'pAceite', tono: 'oro' }],
  [/agua purificada/, { icono: 'pAgua', tono: 'verde' }],
  [/leche/, { icono: 'pLeche', tono: 'crema' }],
  [/cafe|atole|preparados para bebidas/, { icono: 'pCafe', tono: 'vino' }],
  [/jugo|nectar|bebidas de fruta|refresco/, { icono: 'pJugo', tono: 'guinda' }],
  [/atun|sardina|pescado|marisco/, { icono: 'pPescado', tono: 'verde' }],
  [/galleta|pan de caja|hotcake|hornear/, { icono: 'pPan', tono: 'oro' }],
  [/harina|avena|cereal|maiz|soya|amaranto|frijol|arroz/, { icono: 'pGrano', tono: 'arena' }],
  [/pasta|consome/, { icono: 'pPasta', tono: 'guinda' }],
  [/chile|salsa|catsup|mole|mayonesa|mostaza|pure|vinagre|\bsal\b|extracto/, { icono: 'pSalsa', tono: 'guinda' }],
  [/elote|chicharo|vegetal|fruta|mermelada/, { icono: 'pVerdura', tono: 'verde' }],
  [/dulce|caramelo|gelatina|flan/, { icono: 'pDulce', tono: 'guinda' }],
  [/detergente|lavanderia|suavizante|blanqueador/, { icono: 'pLavado', tono: 'pino' }],
  [/insecticida|raticida/, { icono: 'pPlaga', tono: 'pino' }],
  [/limpiador|desinfectante|aromatizante|acido|escoba|fibra|estropajo|trapeador|mechudo/, { icono: 'pLimpieza', tono: 'pino' }],
  [/dental/, { icono: 'pDental', tono: 'verde' }],
  [/shampoo|acondicionador|fijador/, { icono: 'pCabello', tono: 'verde' }],
  [/tocador|cremas para uso|desodorante|uso personal/, { icono: 'pAseo', tono: 'verde' }],
  [/papel|servilleta|panuelo/, { icono: 'pPapel', tono: 'crema' }],
  [/toallas sanitarias|curacion|alcohol/, { icono: 'pSalud', tono: 'guinda' }],
  [/vela|cerillo/, { icono: 'pVela', tono: 'oro' }],
  [/foco/, { icono: 'pFoco', tono: 'arena' }],
  [/escolar/, { icono: 'pEscolar', tono: 'pino' }],
  [/bolsa/, { icono: 'pBolsa', tono: 'vino' }],
  [/palillo|plastico/, { icono: 'pUtensilio', tono: 'vino' }],
  [/lamina/, { icono: 'pLamina', tono: 'pino' }],
  [/herramienta|campo/, { icono: 'pCampo', tono: 'verde' }],
  [/pecuario/, { icono: 'pAnimal', tono: 'oro' }],
];

const OTRO: Estilo = { icono: 'producto', tono: 'vino' };

export function estiloProducto(nombre: string): Estilo {
  const n = sinAcentos(nombre);
  return REGLAS.find(([re]) => re.test(n))?.[1] ?? OTRO;
}

/**
 * Ilustración del producto con los colores de la app: fondo del tono de su categoría, círculos decorativos, el ícono
 * en un medallón y abajo una franja como la del encabezado.
 */
export function IlustracionProducto({ nombre, tamIcono = 40, style }: { nombre: string; tamIcono?: number; style?: ViewStyle }) {
  const { icono, tono } = estiloProducto(nombre);
  const c = TONOS[tono];
  const medallon = tamIcono * 2.1;
  return (
    <View style={[styles.fondo, { backgroundColor: c.fondo }, style]}>
      <View style={[styles.circulo, styles.circuloGrande]} />
      <View style={[styles.circulo, styles.circuloChico]} />
      <View style={[styles.medallon, { width: medallon, height: medallon, borderRadius: medallon / 2 }]}>
        <Icono nombre={icono} color={c.icono} tam={tamIcono} />
      </View>
      <View style={[styles.franja, { backgroundColor: c.franja }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fondo: { width: '100%', aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  circulo: { position: 'absolute', aspectRatio: 1, borderRadius: 9999 },
  circuloGrande: { width: '75%', top: '-35%', right: '-22%', backgroundColor: 'rgba(255,255,255,0.12)' },
  circuloChico: { width: '45%', bottom: '-25%', left: '-12%', backgroundColor: 'rgba(0,0,0,0.08)' },
  medallon: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
  },
  franja: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
});
