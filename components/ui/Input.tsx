import { forwardRef } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';

type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, style, ...rest },
  ref
) {
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const card = useThemeColor({}, 'card');

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={[styles.label, { color: muted }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={muted}
        style={[
          styles.input,
          {
            color: text,
            backgroundColor: card,
            borderColor: error ? danger : border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[styles.helper, { color: danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.helper, { color: muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.xs,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  input: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
  },
  helper: {
    fontSize: FontSize.xs,
  },
});
