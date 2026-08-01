import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { useActivePlans } from '@/hooks/useMember';
import { authErrorMessage } from '@/lib/authErrors';
import { createMember, recordPayment } from '@/lib/firestore';
import { formatCurrency, formatDate } from '@/lib/format';
import { termForNewMember } from '@/lib/membership';

const schema = z.object({
  fullName: z.string().min(2, 'Enter the full name'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  phone: z.string().min(7, 'Enter a contact number'),
  emergencyName: z.string().optional(),
  emergencyPhone: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewMember() {
  const { user } = useAuth();
  const { data: plans, loading: plansLoading } = useActivePlans();
  const [planId, setPlanId] = useState<string | null>(null);
  const [collectPayment, setCollectPayment] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const brandMuted = useThemeColor({}, 'brandMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      emergencyName: '',
      emergencyPhone: '',
      notes: '',
    },
  });

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;
  const term = selectedPlan ? termForNewMember(selectedPlan) : null;

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    if (!selectedPlan || !term) {
      setFormError('Choose a membership plan.');
      return;
    }

    try {
      const created = await createMember({
        fullName: values.fullName.trim(),
        email: values.email.trim().toLowerCase(),
        phone: values.phone.trim(),
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        startDate: term.start,
        endDate: term.end,
        notes: values.notes?.trim() || undefined,
        emergencyContact: values.emergencyName?.trim()
          ? {
              name: values.emergencyName.trim(),
              phone: values.emergencyPhone?.trim() ?? '',
            }
          : undefined,
      });

      // Writing the payment is what drives the sales dashboard counters via the trigger.
      if (collectPayment) {
        await recordPayment({
          memberId: created.id,
          memberName: values.fullName.trim(),
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          amountCents: selectedPlan.priceCents,
          method: 'cash',
          kind: 'new',
          periodStart: term.start,
          periodEnd: term.end,
          recordedBy: user?.uid ?? 'unknown',
        });
      }

      router.replace(`/(admin)/members/${created.id}`);
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  };

  if (!plansLoading && plans.length === 0) {
    return (
      <Screen>
        <Card>
          <EmptyState
            title="No active plans"
            message="Create a membership plan first — every member needs one."
            actionLabel="Go to Plans"
            onAction={() => router.replace('/(admin)/plans')}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={{ gap: Spacing.lg }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Member details</Text>

        <Controller
          control={control}
          name="fullName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Full name"
              placeholder="Juan Dela Cruz"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.fullName?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Email"
              placeholder="member@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.email?.message}
              hint="Expiry reminders go to this address."
            />
          )}
        />

        <Controller
          control={control}
          name="phone"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Phone"
              placeholder="09XX XXX XXXX"
              keyboardType="phone-pad"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.phone?.message}
            />
          )}
        />
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Plan</Text>
        {plans.map((plan) => {
          const selected = plan.id === planId;
          return (
            <Pressable
              key={plan.id}
              onPress={() => setPlanId(plan.id)}
              style={[
                styles.planOption,
                {
                  backgroundColor: selected ? brandMuted : surface,
                  borderColor: selected ? brand : border,
                },
              ]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: text, fontWeight: FontWeight.semibold }}>{plan.name}</Text>
                <Text style={{ color: muted, fontSize: FontSize.sm }}>
                  {plan.durationMonths} month{plan.durationMonths === 1 ? '' : 's'}
                </Text>
              </View>
              <Text style={{ color: selected ? brand : text, fontWeight: FontWeight.bold }}>
                {formatCurrency(plan.priceCents)}
              </Text>
            </Pressable>
          );
        })}
        {term ? (
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            Term: {formatDate(term.start)} — {formatDate(term.end)}
          </Text>
        ) : null}
      </Card>

      <Card style={{ gap: Spacing.lg }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Emergency contact (optional)</Text>
        <Controller
          control={control}
          name="emergencyName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Name" value={value} onBlur={onBlur} onChangeText={onChange} />
          )}
        />
        <Controller
          control={control}
          name="emergencyPhone"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Phone"
              keyboardType="phone-pad"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Notes"
              placeholder="Injuries, goals, preferences…"
              multiline
              numberOfLines={3}
              style={styles.multiline}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
            />
          )}
        />
      </Card>

      <Pressable onPress={() => setCollectPayment((prev) => !prev)}>
        <Card style={styles.checkRow}>
          <View
            style={[
              styles.checkbox,
              {
                borderColor: collectPayment ? brand : border,
                backgroundColor: collectPayment ? brand : 'transparent',
              },
            ]}>
            {collectPayment ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: text, fontWeight: FontWeight.medium }}>
              Record payment now
            </Text>
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              Logs {selectedPlan ? formatCurrency(selectedPlan.priceCents) : 'the plan price'} as
              cash and updates the sales dashboard.
            </Text>
          </View>
        </Card>
      </Pressable>

      {formError ? <Text style={{ color: danger }}>{formError}</Text> : null}

      <Button title="Create member" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  planOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  multiline: { minHeight: 88, paddingTop: Spacing.md, textAlignVertical: 'top' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
