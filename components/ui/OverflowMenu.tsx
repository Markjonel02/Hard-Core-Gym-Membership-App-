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
};

/**
 * Header overflow menu — the destinations that don't earn a permanent tab.
 *
 * The tab bar holds the three screens the front desk touches all day; everything else lives
 * here. A `Modal` rather than an absolutely-positioned popover because it is the only thing
 * that reliably draws above a `Tabs` header on Android *and* web, and it gives the
 * tap-outside-to-close backdrop for free.
 */
export function OverflowMenu({ items }: { items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');

  const choose = (item: OverflowMenuItem) => {
    // Closing first keeps the modal from lingering over the screen it just navigated to.
    setOpen(false);
    item.onPress();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          { backgroundColor: pressed ? surface : 'transparent' },
        ]}>
        <SymbolView
          name={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }}
          tintColor={text}
          size={24}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
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
                marginTop: insets.top + Spacing.xxl + Spacing.md,
              },
            ]}>
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
                <SymbolView name={item.icon} tintColor={muted} size={22} />
                <View style={styles.itemText}>
                  <Text style={[styles.label, { color: text }]}>{item.label}</Text>
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'flex-end',
  },
  sheet: {
    minWidth: 240,
    marginRight: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
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
