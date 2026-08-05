import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import QRCode from 'react-native-qrcode-svg';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/Theme';
import {
  buildNonMemberPass,
  clearLocalPass,
  loadLocalPass,
  newNonMemberId,
  passDisplayName,
  saveLocalPass,
  type NonMemberPassIdentity,
} from '@/lib/nonMembers';

/**
 * `fee` is a string because that is what a `TextInput` gives back, and because the empty string
 * has to stay distinguishable from zero: blank means "not priced yet" and shows the default,
 * while an explicit `0` is a comp the desk chose to give. Parsed to cents on submit.
 *
 * It is validated only in `desk` mode — a visitor minting their own pass is not paying anything
 * yet, so requiring a number from them would block the QR they came for.
 */
const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, 'Last name is required'),
  fee: z
    .string()
    .trim()
    .optional()
    .refine((raw) => !raw || Number.isFinite(Number(raw)), 'Enter an amount like 150')
    .refine((raw) => !raw || Number(raw) >= 0, 'Amount cannot be negative'),
});

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { firstName: '', middleName: '', lastName: '', fee: '' };

/**
 * Pesos as typed → integer centavos, matching every other amount in the payments collection.
 *
 * Blank is not zero: an empty field means the desk did not price the visit and the default
 * applies, while a typed `0` is a deliberate comp. `Number('')` is 0, so the blank case has to
 * be caught before parsing or every unpriced walk-in would silently comp itself.
 */
function toCents(raw: string | undefined, fallbackPesos: number): number {
  const trimmed = (raw ?? '').trim();
  const pesos = trimmed === '' ? fallbackPesos : Number(trimmed);
  return Number.isFinite(pesos) ? Math.round(pesos * 100) : 0;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * `pass` — the visitor's own device: mint an id, remember it locally, show the QR.
   * `desk`  — staff logging someone who doesn't have the app: hand the identity to `onRegister`
   *           and never persist anything on the shared front-desk device.
   */
  mode?: 'pass' | 'desk';
  /**
   * Required in `desk` mode. Writes the nonMembers doc, the attendance row, and the payment when
   * a fee is charged.
   */
  onRegister?: (identity: Required<NonMemberPassIdentity>, amountCents: number) => Promise<void>;
  /** Default walk-in fee in pesos, prefilled in the amount field. Editable so a visit can be comped. */
  defaultFeePesos?: number;
};

/**
 * Name-only registration for a walk-in, ending in a scannable QR.
 *
 * A `Modal` rather than a route because it has to work from the sign-in screen, which sits
 * outside every authenticated group — and because the same component serves the front desk from
 * the attendance screen. Same pattern as `components/ui/OverflowMenu.tsx`: it is the one thing
 * that draws above a header reliably on Android and web, with the tap-outside backdrop for free.
 *
 * In `pass` mode nothing is written to Firestore. The visitor has no auth session, so the QR is
 * the entire artifact — the `nonMembers` document is created by staff when it gets scanned.
 */
export function NonMemberPassModal({
  visible,
  onClose,
  mode = 'pass',
  onRegister,
  defaultFeePesos = 0,
}: Props) {
  const [identity, setIdentity] = useState<Required<NonMemberPassIdentity> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const brand = useThemeColor({}, 'brand');
  const danger = useThemeColor({}, 'danger');

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  /**
   * Reopening the modal restores the pass this device already holds instead of minting a second
   * id for the same person — otherwise every visit would look like a new visitor in the log.
   * `desk` mode deliberately skips this: the front-desk tablet is shared, and resurfacing the
   * last walk-in's name to the next one would be both wrong and a small privacy leak.
   */
  useEffect(() => {
    if (!visible) return;
    setFormError(null);

    if (mode === 'desk') {
      setIdentity(null);
      reset({ ...EMPTY, fee: String(defaultFeePesos || '') });
      return;
    }

    let cancelled = false;
    void loadLocalPass().then((saved) => {
      if (cancelled || !saved) return;
      setIdentity(saved);
      reset({
        firstName: saved.firstName,
        middleName: saved.middleName ?? '',
        lastName: saved.lastName,
        fee: '',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visible, mode, defaultFeePesos, reset]);

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    const next: Required<NonMemberPassIdentity> = {
      // Reuses the existing id when this is the same device re-registering, so a corrected
      // spelling updates the record on the next scan rather than forking a new one.
      id: identity?.id ?? newNonMemberId(),
      firstName: values.firstName.trim(),
      middleName: values.middleName?.trim() ? values.middleName.trim() : null,
      lastName: values.lastName.trim(),
    };

    if (mode === 'desk') {
      try {
        const amountCents = toCents(values.fee, defaultFeePesos);
        await onRegister?.(next, amountCents);
        onClose();
      } catch (error) {
        console.error('[nonmember] desk registration failed', error);
        setFormError('Could not save this walk-in. Check the connection and try again.');
      }
      return;
    }

    await saveLocalPass(next);
    setIdentity(next);
  };

  /** "Not you?" — drops the remembered pass so the next person on this device starts clean. */
  const startOver = useCallback(async () => {
    await clearLocalPass();
    setIdentity(null);
    setFormError(null);
    reset(EMPTY);
  }, [reset]);

  // In pass mode the QR replaces the form once an identity exists; desk mode never gets here.
  const showPass = mode === 'pass' && identity !== null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows taps on the sheet so they don't reach the backdrop and dismiss it mid-entry. */}
        <Pressable
          onPress={() => {}}
          style={[styles.sheet, Shadow.card, { backgroundColor: card, borderColor: border }]}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {showPass && identity ? (
              <>
                <Text style={[styles.title, { color: text }]}>Your gym pass</Text>
                <Text style={[styles.subtitle, { color: muted }]}>
                  Show this at the front desk. Staff scan it and you're checked in.
                </Text>

                <View style={[styles.qrFrame, { borderColor: border }]}>
                  <QRCode
                    value={buildNonMemberPass(identity)}
                    size={200}
                    backgroundColor="#ffffff"
                    color="#000000"
                  />
                </View>

                <Text style={[styles.passName, { color: text }]}>
                  {passDisplayName(identity)}
                </Text>
                <Text style={[styles.subtitle, { color: muted }]}>
                  This pass stays on your phone — reopen it any time from the sign-in screen.
                </Text>

                <Button title="Done" onPress={onClose} />
                <Button title="Not you? Start over" variant="ghost" onPress={startOver} />
              </>
            ) : (
              <>
                <Text style={[styles.title, { color: text }]}>
                  {mode === 'desk' ? 'Log a walk-in' : 'Continue as a non-member'}
                </Text>
                <Text style={[styles.subtitle, { color: muted }]}>
                  {mode === 'desk'
                    ? "Enter their name to check them in now. No app or account needed."
                    : 'Just your name — no account needed. You get a QR the front desk can scan.'}
                </Text>

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
                      returnKeyType={mode === 'desk' ? 'next' : 'go'}
                      onSubmitEditing={mode === 'desk' ? undefined : handleSubmit(onSubmit)}
                    />
                  )}
                />

                {mode === 'desk' ? (
                  <Controller
                    control={control}
                    name="fee"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <Input
                        label="Day-pass fee (₱)"
                        placeholder={String(defaultFeePesos || 0)}
                        keyboardType="decimal-pad"
                        value={value}
                        onBlur={onBlur}
                        onChangeText={onChange}
                        error={errors.fee?.message}
                        hint="Leave blank to use the default. Enter 0 to comp the visit."
                        returnKeyType="go"
                        onSubmitEditing={handleSubmit(onSubmit)}
                      />
                    )}
                  />
                ) : null}

                {formError ? (
                  <Text style={{ color: danger, fontSize: FontSize.sm }}>{formError}</Text>
                ) : null}

                <Button
                  title={mode === 'desk' ? 'Check in walk-in' : 'Get my QR pass'}
                  loading={isSubmitting}
                  onPress={handleSubmit(onSubmit)}
                />
                <Pressable onPress={onClose} accessibilityRole="button">
                  <Text style={[styles.cancel, { color: brand }]}>Cancel</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    alignSelf: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: { padding: Spacing.xl, gap: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  subtitle: { fontSize: FontSize.sm, lineHeight: 19 },
  // White plate behind the QR so it stays scannable in dark mode.
  qrFrame: {
    alignSelf: 'center',
    padding: Spacing.lg,
    backgroundColor: '#ffffff',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  passName: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, textAlign: 'center' },
  cancel: { fontWeight: FontWeight.semibold, textAlign: 'center', paddingVertical: Spacing.sm },
});
