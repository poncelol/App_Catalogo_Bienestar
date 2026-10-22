import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { ESTADO_REGION, REGIONES, SIGLAS } from '@/data/abasto';
import { NAL } from '@/data/abasto-context';
import { ESTADOS, MAPA_ALTO, MAPA_ANCHO } from '@/data/mapa-mexico';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

// Un color por gerencia regional (en oscuro, más claros para que contrasten)
const PALETA = {
  light: ['#9B2247', '#1E5B4F', '#A57F2C', '#2E6B9E', '#3E8E7E', '#611232', '#7A5C1E', '#B5547A', '#002F2A', '#4C7A3A', '#7B4F9E', '#C06A2B'],
  dark: ['#D9708F', '#5FAE9C', '#CFB579', '#6AA6DE', '#8FD3C2', '#C77D93', '#B8955A', '#E59AB3', '#94A3B8', '#8CC26E', '#B58BD9', '#E8955A'],
};
const NEGRO = '#111111';

export function useColoresRegion(): Record<string, string> {
  const oscuro = useColorScheme() === 'dark';
  return useMemo(() => Object.fromEntries(SIGLAS.map((s, i) => [s, PALETA[oscuro ? 'dark' : 'light'][i]])), [oscuro]);
}

// Centro aproximado de cada región (promedio de los centros de sus estados), para poner la sigla
const CENTROS = Object.fromEntries(
  SIGLAS.map((sig) => {
    const es = ESTADOS.filter((e) => REGIONES[sig].estados.includes(e.nombre));
    return [sig, [es.reduce((a, e) => a + e.cx, 0) / es.length, es.reduce((a, e) => a + e.cy, 0) / es.length]];
  }),
);

/**
 * Mapa de México con los estados coloreados por gerencia regional. Al tocar un estado se elige su región.
 * Con `seleccion` = sigla, las demás regiones quedan en gris; con `seleccion` = NAL, todo el país va en negro.
 */
export function MapaRegiones({ seleccion, onElegir }: { seleccion: string | null; onElegir: (sig: string) => void }) {
  const t = useTheme();
  const colores = useColoresRegion();
  const nacional = seleccion === NAL;
  const color = (sig: string | undefined) => {
    if (nacional) return NEGRO;
    if (!sig) return t.backgroundSelected;   // Ciudad de México: sin unidad operativa
    return seleccion && sig !== seleccion ? t.border : colores[sig];
  };
  return (
    <View style={{ width: '100%', aspectRatio: MAPA_ANCHO / MAPA_ALTO }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${MAPA_ANCHO} ${MAPA_ALTO}`}>
        <G>
          {ESTADOS.map((e) => {
            const sig = ESTADO_REGION[e.nombre];
            return (
              <Path key={e.nombre} d={e.d} fill={color(sig)} stroke={t.backgroundElement} strokeWidth={1.5}
                onPress={sig ? () => onElegir(sig) : undefined} />
            );
          })}
        </G>
        {SIGLAS.map((sig) => (
          <SvgText key={sig} x={CENTROS[sig][0]} y={CENTROS[sig][1] + 7} fontSize={22} fontWeight="bold" textAnchor="middle"
            fill={seleccion && !nacional && sig !== seleccion ? t.muted : '#ffffff'} onPress={() => onElegir(sig)}>
            {sig}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
