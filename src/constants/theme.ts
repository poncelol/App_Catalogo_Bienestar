/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Paleta institucional (Pantone 7420/7421 guinda, 626/627 verde, 1255/7402 dorado); fondos derivados de ella
export const Colors = {
  light: {
    text: '#1f2937',
    background: '#f7f5f0',
    backgroundElement: '#ffffff',
    backgroundSelected: '#efe9dc',
    textSecondary: '#6b7280',
    border: '#e8e2d4',
    muted: '#9ca3af',
    accent: '#9b2247',
    accentSoft: 'rgba(155,34,71,0.10)',
    banner: '#611232',
    green: '#1e5b4f',
    greenDark: '#002f2a',
    gold: '#a57f2c',
    goldLight: '#cfb579',
    cream: '#e6d194',
    blue: '#2E6B9E',
    danger: '#c0392b',
    ok: '#239f52',
  },
  dark: {
    text: '#f3f4f6',
    background: '#0f1716',
    backgroundElement: '#18221f',
    backgroundSelected: '#26322f',
    textSecondary: '#a3aca9',
    border: '#26322f',
    muted: '#6b7673',
    accent: '#d9708f',
    accentSoft: 'rgba(217,112,143,0.15)',
    banner: '#4a0e27',
    green: '#5fae9c',
    greenDark: '#1e5b4f',
    gold: '#cfb579',
    goldLight: '#e6d194',
    cream: '#e6d194',
    blue: '#6AA6DE',
    danger: '#ff7474',
    ok: '#4bd37d',
  },
} as const;

export type Palette = (typeof Colors)['light'] | (typeof Colors)['dark'];

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80, web: 80 }) ?? 0;
export const MaxContentWidth = 800;
