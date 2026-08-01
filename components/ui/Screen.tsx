import { ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';

type ScreenProps = ScrollViewProps & {
  title?: string;
  subtitle?: string;
  /** Set false for screens that manage their own scrolling (e.g. FlatList). */
  scroll?: boolean;
};

/**
 * Standard page chrome: themed background, safe-area bottom padding, optional header.
 * Content is capped at 900px so the web build doesn't stretch edge-to-edge on desktop.
 */
export function Screen({
  title,
  subtitle,
  scroll = true,
  children,
  contentContainerStyle,
  ...rest
}: ScreenProps) {
  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const insets = useSafeAreaInsets();

  const header =
    title || subtitle ? (
      <View style={styles.header}>
        {title ? <Text style={[styles.title, { color: text }]}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.subtitle, { color: muted }]}>{subtitle}</Text> : null}
      </View>
    ) : null;

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: background }]}>
        <View style={[styles.constrain, styles.flex]}>
          {header}
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: background }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + Spacing.xxl },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      {...rest}>
      <View style={styles.constrain}>
        {header}
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
  },
  constrain: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
  },
  subtitle: {
    fontSize: FontSize.md,
  },
});
