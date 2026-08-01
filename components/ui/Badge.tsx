import { StyleSheet, Text, View } from 'react-native';

import { useThemeColor } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand';

type BadgeProps = {
  label: string;
  tone?: BadgeTone;
};

const TONE_KEYS: Record<
  BadgeTone,
  { fg: keyof typeof Colors.light; bg: keyof typeof Colors.light }
> = {
  success: { fg: 'success', bg: 'successMuted' },
  warning: { fg: 'warning', bg: 'warningMuted' },
  danger: { fg: 'danger', bg: 'dangerMuted' },
  brand: { fg: 'brand', bg: 'brandMuted' },
  neutral: { fg: 'muted', bg: 'surface' },
};

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const keys = TONE_KEYS[tone];
  const fg = useThemeColor({}, keys.fg);
  const bg = useThemeColor({}, keys.bg);

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
