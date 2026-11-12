/**
 * Animaciones de la app: discretas y cortas, para que se sienta fluida sin hacerla lenta. Todas respetan la opción
 * «Reducir movimiento» del teléfono (Reanimated la sigue sola; el contador la revisa con useReducedMotion).
 *
 * Las entradas se hacen solo con opacidad y movimiento (no con las animaciones de entrada de Reanimated): esas, una
 * dentro de otra, sacan al elemento del flujo mientras corren y en la web la gráfica se encimaba o desaparecía.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';

import { entero } from '@/data/abasto';

/** subir: aparece subiendo; izquierda/derecha: entra de ese lado; girar: gira y crece; crecer: crece con rebote. */
type Efecto = 'subir' | 'izquierda' | 'derecha' | 'girar' | 'crecer';

/** Entrada al montarse. `animar` en falso: aparece ya en su lugar (p. ej. mensajes que ya estaban). */
export function Entrada({ efecto = 'subir', retraso = 0, duracion = 380, animar = true, style, children }: {
  efecto?: Efecto; retraso?: number; duracion?: number; animar?: boolean; style?: StyleProp<ViewStyle>; children?: ReactNode;
}) {
  const p = useSharedValue(animar ? 0 : 1);
  useEffect(() => {
    if (!animar) return;
    const curva = efecto === 'crecer' ? Easing.out(Easing.back(1.8)) : Easing.out(Easing.cubic);
    p.set(withDelay(retraso, withTiming(1, { duration: duracion, easing: curva })));
  }, [p, animar, retraso, duracion, efecto]);
  const anim = useAnimatedStyle(() => {
    const v = p.get();
    const r = 1 - v;
    switch (efecto) {
      case 'izquierda': return { opacity: v, transform: [{ translateX: -20 * r }] };
      case 'derecha': return { opacity: v, transform: [{ translateX: 20 * r }] };
      case 'girar': return { opacity: v, transform: [{ rotate: `${-100 * r}deg` }, { scale: 1 - 0.15 * r }] };
      case 'crecer': return { opacity: Math.min(v * 2, 1), transform: [{ scale: v }] };
      default: return { opacity: v, transform: [{ translateY: 16 * r }] };
    }
  });
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Entrada escalonada de los bloques de una pantalla: cada uno un poco después del anterior. */
export function Aparecer({ orden = 0, children, style }: { orden?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Entrada retraso={Math.min(orden, 8) * 70} duracion={420} style={style}>{children}</Entrada>;
}

/** Contenido que se despliega («Ver detalle», «Ver cuáles»). */
export function Desplegar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Entrada duracion={220} style={style}>{children}</Entrada>;
}

/** Número que cuenta desde el valor anterior (o desde 0) hasta el nuevo. */
export function NumeroAnimado({ valor, formato = entero, ...props }: { valor: number; formato?: (n: number) => string } & TextProps) {
  const reducido = useReducedMotion();
  const [mostrado, setMostrado] = useState(0);
  const actual = useRef(0);
  useEffect(() => {
    if (reducido) return;
    const desde = actual.current;
    const inicio = Date.now();
    const duracion = 750;
    let id = 0;
    const paso = () => {
      const p = Math.min((Date.now() - inicio) / duracion, 1);
      actual.current = Math.round(desde + (valor - desde) * (1 - (1 - p) ** 3));
      setMostrado(actual.current);
      if (p < 1) id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [valor, reducido]);
  return <Text {...props}>{formato(reducido ? valor : mostrado)}</Text>;
}

/** Barra de proporción que crece desde la izquierda. */
export function BarraAnimada({ fraccion, color, style, retraso = 0 }: {
  fraccion: number; color: string; style?: StyleProp<ViewStyle>; retraso?: number;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(retraso, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) })));
  }, [p, retraso, fraccion]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleX: p.get() }] }));
  return <Animated.View style={[style, { width: `${fraccion * 100}%`, backgroundColor: color, transformOrigin: 'left' }, anim]} />;
}

/** Se mueve una vez de lado a lado (como campana que suena) cuando `activa`. */
export function Sonar({ activa, children, style }: { activa: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const giro = useSharedValue(0);
  useEffect(() => {
    if (!activa) return;
    const paso = (grados: number) => withTiming(grados, { duration: 150, easing: Easing.inOut(Easing.quad) });
    giro.set(withDelay(600, withSequence(paso(-18), paso(14), paso(-9), paso(5), paso(0))));
  }, [giro, activa]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${giro.get()}deg` }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Tres puntos que saltan mientras el asistente escribe. */
export function Escribiendo({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', height: 14 }}>
      {[0, 1, 2].map((i) => <Punto key={i} i={i} color={color} />)}
    </View>
  );
}

function Punto({ i, color }: { i: number; color: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.set(withDelay(i * 140, withRepeat(withSequence(
      withTiming(-4, { duration: 260, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 280 }),
    ), -1)));
  }, [y, i]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, anim]} />;
}
