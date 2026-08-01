import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { useThemeColor } from '@/components/Themed';
import { Radius, Shadow, Spacing } from '@/constants/Theme';

type CardProps = ViewProps & {
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
};

export function Card({ padded = true, style, children, ...rest }: CardProps) {
  const backgroundColor = useThemeColor({}, 'card');
  const borderColor = useThemeColor({}, 'border');

  return (
    <View
      style={[
        styles.card,
        Shadow.card,
        { backgroundColor, borderColor },
        padded && styles.padded,
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  padded: {
    padding: Spacing.lg,
  },
});
