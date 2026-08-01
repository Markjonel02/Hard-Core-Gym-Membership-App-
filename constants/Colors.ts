/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */
const tintColorLight = '#e8442c';
const tintColorDark = '#ff6a4d';

export default {
  light: {
    text: '#0d1117',
    background: '#f6f7f9',
    tint: tintColorLight,
    tabIconDefault: '#9aa4b2',
    tabIconSelected: tintColorLight,

    brand: '#e8442c',
    brandMuted: '#fdece9',
    card: '#ffffff',
    surface: '#eceff3',
    border: '#e2e6ec',
    muted: '#667085',
    success: '#12855b',
    successMuted: '#e3f6ed',
    warning: '#b3701a',
    warningMuted: '#fdf1e0',
    danger: '#c8372d',
    dangerMuted: '#fdeceb',
  },
  dark: {
    text: '#e9eef5',
    background: '#0b0e13',
    tint: tintColorDark,
    tabIconDefault: '#6b7686',
    tabIconSelected: tintColorDark,

    brand: '#ff6a4d',
    brandMuted: '#2a1512',
    card: '#151a22',
    surface: '#1d232d',
    border: '#252c38',
    muted: '#98a2b3',
    success: '#3ddc97',
    successMuted: '#10241c',
    warning: '#f0b249',
    warningMuted: '#241c0f',
    danger: '#ff6b6b',
    dangerMuted: '#2a1315',
  },
};
