import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { useActivePlans } from '@/hooks/useMember';
import { authErrorMessage } from '@/lib/authErrors';
import { createMember, recordPayment } from '@/lib/firestore';
import { formatCurrency, formatDate } from '@/lib/format';
import { termForNewMember } from '@/lib/membership';
import { composeFullName } from '@/lib/names';
import { isValidPhone, normalizePhone, PHONE_ERROR, PHONE_HINT } from '@/lib/phone';
import { provisionMemberLogin } from '@/lib/provisionMemberLogin';
import { USERNAME_HINT, validateUsername } from '@/lib/usernameRules';

/** Matches the retired sign-up form, so a credential issued here is as strong as a self-serve one. */
const MIN_PASSWORD = 8;

/**
 * The credential fields are optional *in the schema* and required by a check in `onSubmit`.
 *
 * They only apply when this form is creating a new login. Opened from the Accounts screen the
 * member already has one, and zod cannot see that — `linkedUid` lives outside the form. Marking
 * them required here would block that path with errors on fields it does not even render.
 */
const schema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    middleName: z.string().optional(),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email'),
    phone: z.string().min(1, 'Phone number is required').refine(isValidPhone, PHONE_ERROR),
    username: z.string().optional(),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
    emergencyName: z.string().optional(),
    emergencyPhone: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((values) => !values.password || values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((values) => !values.password || values.password.length >= MIN_PASSWORD, {
    message: `Password must be at least ${MIN_PASSWORD} characters`,
    path: ['password'],
  })
  .refine(
    // `validateUsername` returns an error *message* or null, so the truthiness is inverted from
    // what a predicate normally reads like. Getting this backwards accepts every invalid name.
    (values) => !values.username || !validateUsername(values.username),
    { message: 'Use 3-20 letters, numbers, dots or underscores', path: ['username'] }
  );

type FormValues = z.infer<typeof schema>;

export default function NewMember() {
  const { user } = useAuth();
  const { data: plans, loading: plansLoading, error: plansError } = useActivePlans();
  const [planId, setPlanId] = useState<string | null>(null);
  const [collectPayment, setCollectPayment] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * The plan lives outside the form, so zod can't flag it. Without this the only signal was a
   * sentence rendered next to the button at the bottom of a long scroll — from the plan list,
   * where the eye actually is, pressing Create looked like it did nothing at all.
   */
  const [planError, setPlanError] = useState(false);
  /**
   * Tracks that the Auth account exists so a later failure can say so. Without it the admin is
   * told "create failed", retries, and gets `auth/email-already-in-use` — which reads as a
   * second, unrelated bug rather than the tail of the first one.
   */
  const [loginCreated, setLoginCreated] = useState(false);

  /**
   * Prefill, arriving from the "Waiting for a membership" card on the sales dashboard.
   *
   * `uid` is the load-bearing one. Creating a member doc without it produces a record that
   * looks right on the admin roster but is attached to no login, so the person still sees
   * "no membership linked" and still has no QR code. Carrying the uid through is what turns
   * an account into a member rather than creating a lookalike beside it.
   */
  const params = useLocalSearchParams<{
    uid?: string;
    email?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    phone?: string;
  }>();
  const linkedUid = typeof params.uid === 'string' && params.uid ? params.uid : null;
  /**
   * Only this form creates the login. Arriving from Accounts the person already has one, and
   * showing credential fields there would invite an admin to create a second account for
   * someone who is standing in front of them precisely because they already signed up.
   */
  const needsCredentials = linkedUid === null;

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
      firstName: typeof params.firstName === 'string' ? params.firstName : '',
      middleName: typeof params.middleName === 'string' ? params.middleName : '',
      lastName: typeof params.lastName === 'string' ? params.lastName : '',
      email: typeof params.email === 'string' ? params.email : '',
      phone: typeof params.phone === 'string' ? params.phone : '',
      username: '',
      password: '',
      confirmPassword: '',
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
      setPlanError(true);
      setFormError('Choose a membership plan above.');
      return;
    }
    setPlanError(false);

    /*
     * Credentials are required when this form is creating the login, which zod cannot enforce
     * because `linkedUid` is not a form field. Checked here instead of silently creating a
     * member with no way to sign in — the exact gap this whole change exists to close.
     */
    if (needsCredentials) {
      const missing =
        !values.username?.trim() || !values.password || !values.confirmPassword;
      if (missing) {
        setFormError('Set a username and password so the member can sign in.');
        return;
      }
    }

    try {
      const memberName = composeFullName(values);

      /*
       * Provisioned before the member doc, deliberately. If this throws, nothing was written and
       * the admin can correct the username or email and press Create again. The reverse order
       * would leave a member record behind on every failed attempt.
       *
       * If `createMember` fails *after* this succeeds the login still exists — that is why the
       * catch below says so rather than showing a bare error: the Accounts screen's "Add
       * membership" button can then attach a membership to it by uid.
       */
      let uid = linkedUid;
      if (needsCredentials) {
        const provisioned = await provisionMemberLogin({
          email: values.email.trim().toLowerCase(),
          password: values.password ?? '',
          username: values.username ?? '',
          firstName: values.firstName.trim(),
          middleName: values.middleName?.trim() || null,
          lastName: values.lastName.trim(),
          phone: values.phone,
        });
        uid = provisioned.uid;
        setLoginCreated(true);
      }

      const created = await createMember({
        // Links the membership to the login — the one just provisioned, or an existing account
        // when this form was opened from the "Waiting for a membership" card.
        uid,
        firstName: values.firstName.trim(),
        middleName: values.middleName?.trim() || null,
        lastName: values.lastName.trim(),
        email: values.email.trim().toLowerCase(),
        phone: normalizePhone(values.phone) ?? values.phone.trim(),
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
          memberName,
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
      // Logged as well as shown: the on-screen sentence is deliberately short, and a rules
      // rejection here is a deployment problem whose detail belongs in the console.
      console.error('[members/new] create failed', error);
      setFormError(
        loginCreated
          ? `${authErrorMessage(error)}\n\nThe login was already created — retrying here would report the email as in use. Finish from Accounts instead: find them and press "Add membership".`
          : authErrorMessage(error)
      );
    }
  };

  /**
   * react-hook-form's second callback. Field errors render at their own inputs, which on this
   * form are a full screen above the button — so a rejected phone number read as a dead button.
   * This puts a pointer next to the thing that was pressed.
   */
  const onInvalid = () => {
    setPlanError(!selectedPlan);
    setFormError('Some details need fixing — check the fields marked in red above.');
  };

  /*
   * The plans listener has to be given a chance to resolve before this screen decides there
   * are none. Rendering the "No active plans" card while loading is what made "+ Add member"
   * look like it redirected to Plans: the form never appeared, only its fallback did.
   */
  if (plansLoading) {
    return (
      <Screen>
        <SkeletonList rows={3} height={96} />
      </Screen>
    );
  }

  if (plansError) {
    return (
      <Screen>
        <Card>
          <EmptyState
            title="Could not load plans"
            message={`${plansError.message}\n\nThis is a permissions or connection problem — your plans are probably still there.`}
            actionLabel="Back to members"
            onAction={() => router.replace('/(admin)/members')}
          />
        </Card>
      </Screen>
    );
  }

  if (plans.length === 0) {
    return (
      <Screen>
        <Card>
          <EmptyState
            title="No active plans"
            message="Create a membership plan first — every member needs one. A plan must be marked active to appear here."
            actionLabel="Go to Plans"
            onAction={() => router.replace('/(admin)/plans')}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {linkedUid ? (
        <Card style={styles.linkBanner}>
          <Badge label="Linking account" tone="success" />
          <Text style={{ color: muted, fontSize: FontSize.sm, flex: 1 }}>
            This membership will be attached to {params.email || 'the selected account'}, so their
            dashboard and check-in QR start working as soon as you save.
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: Spacing.lg }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Member details</Text>

        <Controller
          control={control}
          name="firstName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="First name"
              placeholder="Juan"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.firstName?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="middleName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Middle name (optional)"
              placeholder="Santos"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.middleName?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="lastName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Last name"
              placeholder="Dela Cruz"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.lastName?.message}
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
              hint={
                needsCredentials
                  ? 'Must be a real address they can open — they have to click a verification link before their first sign-in.'
                  : 'Expiry reminders go to this address.'
              }
            />
          )}
        />

        <Controller
          control={control}
          name="phone"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Phone"
              placeholder="0917 123 4567"
              keyboardType="phone-pad"
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={errors.phone?.message}
              hint={PHONE_HINT}
            />
          )}
        />
      </Card>

      {needsCredentials ? (
        <Card style={{ gap: Spacing.lg }}>
          <View style={{ gap: Spacing.xs }}>
            <Text style={[styles.sectionTitle, { color: text }]}>Sign-in credentials</Text>
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              Creates the member's login. Hand these over at the desk — they sign in with the
              username or their email.
            </Text>
          </View>

          <Controller
            control={control}
            name="username"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Username"
                placeholder="juan.delacruz"
                autoCapitalize="none"
                autoCorrect={false}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={errors.username?.message}
                hint={USERNAME_HINT}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Password"
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={errors.password?.message}
                hint={`At least ${MIN_PASSWORD} characters. Ask them to change it after signing in.`}
              />
            )}
          />

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Confirm password"
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={errors.confirmPassword?.message}
              />
            )}
          />

          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            A verification email goes out automatically. The member has to click that link before
            their first sign-in — until then they see the verification screen, not their dashboard.
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Plan</Text>
        {plans.map((plan) => {
          const selected = plan.id === planId;
          return (
            <Pressable
              key={plan.id}
              onPress={() => {
                setPlanId(plan.id);
                setPlanError(false);
                setFormError(null);
              }}
              style={[
                styles.planOption,
                {
                  backgroundColor: selected ? brandMuted : surface,
                  borderColor: selected ? brand : planError ? danger : border,
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
        {planError ? (
          <Text style={{ color: danger, fontSize: FontSize.sm }}>
            Pick a plan — a membership can't be created without one.
          </Text>
        ) : null}
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

      <Button
        title="Create member"
        loading={isSubmitting}
        onPress={handleSubmit(onSubmit, onInvalid)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  linkBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
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
