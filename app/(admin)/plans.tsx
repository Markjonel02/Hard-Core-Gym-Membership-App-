import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { useAllPlans } from '@/hooks/useMember';
import { authErrorMessage } from '@/lib/authErrors';
import { savePlan } from '@/lib/firestore';
import { formatCurrency } from '@/lib/format';
import type { Plan } from '@/types/models';

type Draft = {
  id?: string;
  name: string;
  price: string;
  durationMonths: string;
  perks: string;
  active: boolean;
};

const EMPTY: Draft = { name: '', price: '', durationMonths: '1', perks: '', active: true };

export default function Plans() {
  const { data: plans, loading } = useAllPlans();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const danger = useThemeColor({}, 'danger');

  const editPlan = (plan: Plan) =>
    setDraft({
      id: plan.id,
      name: plan.name,
      price: String((plan.priceCents ?? 0) / 100),
      durationMonths: String(plan.durationMonths ?? 1),
      perks: (plan.perks ?? []).join('\n'),
      active: plan.active,
    });

  const submit = async () => {
    if (!draft) return;
    setError(null);

    const price = Number(draft.price);
    const months = Number(draft.durationMonths);
    if (!draft.name.trim()) return setError('Give the plan a name.');
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price.');
    if (!Number.isInteger(months) || months < 1) return setError('Duration must be 1 month or more.');

    setSaving(true);
    try {
      await savePlan({
        id: draft.id,
        name: draft.name.trim(),
        // Stored as integer cents; round to avoid float artifacts like 149999.99999.
        priceCents: Math.round(price * 100),
        durationMonths: months,
        active: draft.active,
        perks: draft.perks
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setDraft(null);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title="Plans" subtitle="What members can buy">
      {draft ? (
        <Card style={{ gap: Spacing.lg }}>
          <Text style={[styles.sectionTitle, { color: text }]}>
            {draft.id ? 'Edit plan' : 'New plan'}
          </Text>
          <Input
            label="Name"
            placeholder="Monthly Unlimited"
            value={draft.name}
            onChangeText={(name) => setDraft({ ...draft, name })}
          />
          <Input
            label="Price"
            placeholder="1500"
            keyboardType="decimal-pad"
            value={draft.price}
            onChangeText={(price) => setDraft({ ...draft, price })}
          />
          <Input
            label="Duration (months)"
            placeholder="1"
            keyboardType="number-pad"
            value={draft.durationMonths}
            onChangeText={(durationMonths) => setDraft({ ...draft, durationMonths })}
          />
          <Input
            label="Perks (one per line)"
            placeholder={'Unlimited gym access\nFree locker'}
            multiline
            numberOfLines={4}
            style={styles.multiline}
            value={draft.perks}
            onChangeText={(perks) => setDraft({ ...draft, perks })}
          />
          <View style={styles.switchRow}>
            <Text style={{ color: text, flex: 1 }}>Available for sale</Text>
            <Switch
              value={draft.active}
              onValueChange={(active) => setDraft({ ...draft, active })}
              trackColor={{ true: brand }}
            />
          </View>
          {error ? <Text style={{ color: danger }}>{error}</Text> : null}
          <Button title="Save plan" loading={saving} onPress={() => void submit()} />
          <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} />
        </Card>
      ) : (
        <Button title="+ New plan" onPress={() => setDraft(EMPTY)} />
      )}

      {loading ? (
        <SkeletonList rows={3} height={90} />
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState
            title="No plans yet"
            message="Create at least one plan before adding members."
            actionLabel="New plan"
            onAction={() => setDraft(EMPTY)}
          />
        </Card>
      ) : (
        plans.map((plan) => (
          <Pressable key={plan.id} onPress={() => editPlan(plan)}>
            {({ pressed }) => (
              <Card style={{ gap: Spacing.sm, opacity: pressed ? 0.7 : 1 }}>
                <View style={styles.planHeader}>
                  <Text style={[styles.planName, { color: text }]}>{plan.name}</Text>
                  <Text style={[styles.price, { color: brand }]}>
                    {formatCurrency(plan.priceCents)}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={{ color: muted, fontSize: FontSize.sm }}>
                    {plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'}
                  </Text>
                  <Badge
                    label={plan.active ? 'active' : 'hidden'}
                    tone={plan.active ? 'success' : 'neutral'}
                  />
                </View>
                {plan.perks?.length ? (
                  <View style={{ gap: 2 }}>
                    {plan.perks.map((perk) => (
                      <Text key={perk} style={{ color: muted, fontSize: FontSize.sm }}>
                        • {perk}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </Card>
            )}
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  planName: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, flex: 1 },
  price: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  multiline: { minHeight: 110, paddingTop: Spacing.md, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
