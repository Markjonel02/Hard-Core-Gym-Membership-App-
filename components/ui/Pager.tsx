import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Button } from '@/components/ui/Button';
import { useThemeColor } from '@/components/Themed';
import { FontSize, Spacing } from '@/constants/Theme';
import type { Pagination } from '@/hooks/usePagination';

type PagerProps = {
  pagination: Pagination<unknown>;
  /** Plural noun for the range label, e.g. "visits". Omitted reads as plain "6–10 of 23". */
  label?: string;
  style?: ViewStyle;
};

/**
 * Prev/Next with a "6–10 of 23" range.
 *
 * Renders nothing when the whole list fits on one page, so a list of three visits looks exactly
 * as it did before — the control only shows up once the data actually exceeds a page.
 */
export function Pager({ pagination, label, style }: PagerProps) {
  const { page, pageCount, total, from, to, next, prev, hasPages } = pagination;

  const muted = useThemeColor({}, 'muted');
  const border = useThemeColor({}, 'border');

  if (!hasPages) return null;

  return (
    <View style={[styles.row, { borderTopColor: border }, style]}>
      <Text style={[styles.range, { color: muted }]}>
        {from}–{to} of {total}
        {label ? ` ${label}` : ''}
      </Text>
      <View style={styles.buttons}>
        <Button
          title="Prev"
          variant="ghost"
          fullWidth={false}
          disabled={page === 0}
          onPress={prev}
          style={styles.button}
        />
        <Button
          title="Next"
          variant="ghost"
          fullWidth={false}
          disabled={page >= pageCount - 1}
          onPress={next}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  range: { fontSize: FontSize.sm },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
  // Shorter than the 48pt primary buttons: this sits under a list, not at the end of a form.
  button: { minHeight: 36, paddingHorizontal: Spacing.lg },
});
