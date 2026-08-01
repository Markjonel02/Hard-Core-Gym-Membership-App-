import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColor } from '@/components/Themed';
import { Radius, Spacing } from '@/constants/Theme';

type SkeletonProps = {
  height?: number;
  width?: ViewStyle['width'];
  radius?: number;
};

export function Skeleton({ height = 16, width = '100%', radius = Radius.sm }: SkeletonProps) {
  const surface = useThemeColor({}, 'surface');
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 850 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ height, width, borderRadius: radius, backgroundColor: surface }, animatedStyle]}
    />
  );
}

/** Convenience stack for list placeholders. */
export function SkeletonList({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={Radius.lg} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.md,
  },
});
