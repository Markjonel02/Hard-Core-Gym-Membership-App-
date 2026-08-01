import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({
  title,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const brand = useThemeColor({}, 'brand');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const text = useThemeColor({}, 'text');

  const background =
    variant === 'primary'
      ? brand
      : variant === 'danger'
        ? danger
        : variant === 'secondary'
          ? surface
          : 'transparent';

  const labelColor = variant === 'primary' || variant === 'danger' ? '#fff' : text;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderColor: variant === 'ghost' ? border : 'transparent',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : (
        <Text style={[styles.label, { color: labelColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
});
