import { StyleSheet, Text as RNText, type TextProps } from 'react-native';

/**
 * `Text` de la app: todo en MAYÚSCULAS por defecto. Los encabezados, títulos y subtítulos
 * lo desactivan en su estilo con `textTransform: 'none'`.
 */
export function Text({ style, ...rest }: TextProps) {
  return <RNText style={[s.mayus, style]} {...rest} />;
}

const s = StyleSheet.create({ mayus: { textTransform: 'uppercase' } });
