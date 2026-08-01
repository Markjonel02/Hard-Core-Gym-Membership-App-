import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';

type EmptyStateProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.title, { color: text }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: muted }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="secondary" fullWidth={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
});
