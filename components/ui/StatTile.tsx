import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useThemeColor } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';

type StatTileProps = {
  label: string;
  value: string;
  delta?: string;
  tone?: keyof typeof Colors.light;
};

export function StatTile({ label, value, delta, tone = 'text' }: StatTileProps) {
  const muted = useThemeColor({}, 'muted');
  const valueColor = useThemeColor({}, tone);

  return (
    <Card style={styles.tile}>
      <Text style={[styles.label, { color: muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {delta ? (
        <View>
          <Text style={[styles.delta, { color: muted }]} numberOfLines={1}>
            {delta}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    gap: Spacing.xs,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  value: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
  },
  delta: {
    fontSize: FontSize.xs,
  },
});
