import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/Theme';

export type OverflowMenuItem = {
  label: string;
  /** Per-platform symbol name, same shape the tab bar icons use. */
  icon: SymbolViewProps['name'];
  onPress: () => void;
  hint?: string;
  /** Renders the label in the danger colour. For the one item that removes something. */
  destructive?: boolean;
};

type Props = {
  items: OverflowMenuItem[];
  /**
   * `header` — anchored under the navigation bar, for the screen-level menu.
   * `inline` — centred, for a 3-dot button living inside a list row.
   *
   * The distinction is only about where the sheet lands. A header menu drops from a trigger
   * pinned to the top-right, so it hangs from a fixed offset; an inline trigger can be anywhere
   * down a scrolling list, and measuring its position per row to anchor beneath it would be
   * fragile on web and pointless — a centred sheet is unambiguous about which row it belongs to
   * because the row's name is in the title.
   */
  variant?: 'header' | 'inline';
  /** Shown at the top of an inline sheet, so the menu names what it will act on. */
  title?: string;
  /** Overrides the trigger's accessible name; the default is fine for a screen-level menu. */
  accessibilityLabel?: string;
};

/**
 * Overflow menu — a 3-dot trigger and the actions that don't earn their own button.
 *
 * A `Modal` rather than an absolutely-positioned popover because it is the only thing that
 * reliably draws above a `Tabs` header on Android *and* web, and it gives the
 * tap-outside-to-close backdrop for free. Inside a scrolling list that matters more, not less:
 * an inline popover would be clipped by the row's own overflow.
 */
export function OverflowMenu({
  items,
  variant = 'header',
  title,
  accessibilityLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const danger = useThemeColor({}, 'danger');

  const inline = variant === 'inline';

  const choose = (item: OverflowMenuItem) => {
    // Closing first keeps the modal from lingering over the screen it just navigated to.
    setOpen(false);
    item.onPress();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'More'}
        onPress={() => setOpen(true)}
        // Stops the press bubbling to a card that navigates on tap: opening the menu for a row
        // should not also open that row.
        hitSlop={8}
        style={({ pressed }) => [
          styles.trigger,
          inline && styles.triggerInline,
          { backgroundColor: pressed ? surface : 'transparent' },
        ]}>
        <SymbolView
          name={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }}
          tintColor={inline ? muted : text}
          size={inline ? 20 : 24}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[styles.backdrop, inline ? styles.backdropInline : styles.backdropHeader]}
          onPress={() => setOpen(false)}>
          {/*
            Nested Pressable with an empty handler: it swallows taps on the sheet itself so
            they don't reach the backdrop and dismiss the menu mid-choice.
          */}
          <Pressable
            onPress={() => {}}
            style={[
              styles.sheet,
              Shadow.card,
              {
                backgroundColor: card,
                borderColor: border,
                ...(inline
                  ? // `marginRight` is reset explicitly, not just overridden by `marginHorizontal`:
                    // React Native resolves the more specific edge property last regardless of
                    // declaration order, so the header sheet's right margin would survive and
                    // shift a supposedly centred sheet off-centre.
                    { marginRight: 0, marginHorizontal: Spacing.lg, maxWidth: 360, width: '100%' }
                  : { marginTop: insets.top + Spacing.xxl + Spacing.md }),
              },
            ]}>
            {inline && title ? (
              <View style={[styles.sheetTitleRow, { borderBottomColor: border }]}>
                <Text style={[styles.sheetTitle, { color: muted }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            ) : null}
            {items.map((item, index) => (
              <Pressable
                key={item.label}
                accessibilityRole="menuitem"
                onPress={() => choose(item)}
                style={({ pressed }) => [
                  styles.item,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
                  pressed && { backgroundColor: surface },
                ]}>
                <SymbolView name={item.icon} tintColor={item.destructive ? danger : muted} size={22} />
                <View style={styles.itemText}>
                  <Text style={[styles.label, { color: item.destructive ? danger : text }]}>
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text style={[styles.hint, { color: muted }]}>{item.hint}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  triggerInline: { width: 36, height: 36, marginRight: 0 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  backdropHeader: { alignItems: 'flex-end' },
  backdropInline: { alignItems: 'center', justifyContent: 'center' },
  sheet: {
    minWidth: 240,
    marginRight: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  sheetTitleRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 52,
  },
  itemText: { flex: 1, gap: 2 },
  label: { fontSize: FontSize.md, fontWeight: FontWeight.medium },
  hint: { fontSize: FontSize.xs },
});
