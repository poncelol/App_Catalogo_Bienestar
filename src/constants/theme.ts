/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Paleta institucional gob.mx (guinda, verde, dorado) sobre los grises del tablero Mosaic
export const Colors = {
  light: {
    text: '#1f2937',
    background: '#f3f4f6',
    backgroundElement: '#ffffff',
    backgroundSelected: '#e5e7eb',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    muted: '#9ca3af',
    accent: '#9D2449',
    accentSoft: 'rgba(157,36,73,0.10)',
    banner: '#611232',
    green: '#235B4E',
    gold: '#A57F2C',
    blue: '#2E6B9E',
    danger: '#c0392b',
    ok: '#239f52',
  },
  dark: {
    text: '#f3f4f6',
    background: '#111827',
    backgroundElement: '#1f2937',
    backgroundSelected: '#374151',
    textSecondary: '#9ca3af',
    border: '#374151',
    muted: '#6b7280',
    accent: '#E0698C',
    accentSoft: 'rgba(224,105,140,0.15)',
    banner: '#4a0e27',
    green: '#4FB39A',
    gold: '#D9AE55',
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
