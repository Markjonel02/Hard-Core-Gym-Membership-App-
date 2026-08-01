import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight } from '@/constants/Theme';

type ProgressRingProps = {
  /** 0..1 — clamped internally. */
  progress: number;
  size?: number;
  thickness?: number;
  value: string;
  caption?: string;
  color?: string;
};

export function ProgressRing({
  progress,
  size = 160,
  thickness = 12,
  value,
  caption,
  color,
}: ProgressRingProps) {
  const track = useThemeColor({}, 'surface');
  const brand = useThemeColor({}, 'brand');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');

  const stroke = color ?? brand;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={track}
          strokeWidth={thickness}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.value, { color: text }]}>{value}</Text>
        {caption ? <Text style={[styles.caption, { color: muted }]}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
  },
  caption: {
    fontSize: FontSize.sm,
  },
});
