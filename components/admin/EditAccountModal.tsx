import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useThemeColor } from '@/components/Themed';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/Theme';
import { authErrorMessage } from '@/lib/authErrors';
import { updateMember, upsertUserProfile } from '@/lib/firestore';
import { composeFullName } from '@/lib/names';
import { isValidPhone, normalizePhone, PHONE_ERROR, PHONE_HINT } from '@/lib/phone';
import type { Member, UserDoc } from '@/types/models';

/**
 * Same shape as the create form's member half, minus the plan and the credentials.
 *
 * Neither omission is an oversight. The plan and term are changed by the Renew flow on the member
 * detail screen, which knows how to carry remaining days over and record the payment — a plain
 * text field here would move an end date without either. Passwords are not editable by an admin
 * at all: changing one is a reset email the member acts on themselves, not a value someone types
 * on their behalf.
 */
const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  phone: z.string().trim().min(1, 'Phone number is required').refine(isValidPhone, PHONE_ERROR),
  emergencyName: z.string().trim().optional(),
  emergencyPhone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The account being edited. Always present — this modal is opened from an account row. */
  account: UserDoc | null;
  /** Their membership, when they have one. Null for an account that holds no membership yet. */
  member: Member | null;
  onSaved?: (message: string) => void;
};

/**
 * Edits the details behind an account, from the Accounts screen.
 *
 * Writes to as many as two documents, because a member's details genuinely live in two places:
 * `users/{uid}` backs sign-in and the app's own greeting, `members/{id}` backs the roster,
 * receipts and expiry mail. They are separate records with separate rules, and editing only one
 * leaves the desk looking at a name the member does not see. Whichever exists is written; an
 * account with no membership updates its profile alone.
 *
 * Username is rendered read-only rather than omitted, so the field is visible when staff are
 * reading details off the screen to someone. It is not merely disabled in the UI: `usernames`
 * denies update and delete outright and the `users` rule pins the field, so there is no code path
 * that could honour an edit even if this input allowed one.
 */
export function EditAccountModal({ visible, onClose, account, member, onSaved }: Props) {
  const [formError, setFormError] = useState<string | null>(null);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const brand = useThemeColor({}, 'brand');
  const danger = useThemeColor({}, 'danger');

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  /*
   * Refilled every time the modal opens. Without this, react-hook-form keeps the values from
   * whichever account was edited last and the next row opens showing someone else's details —
   * which, on a form that saves to two documents, is how one member's phone number ends up on
   * another's record.
   *
   * The membership doc wins on every shared field: it is what the front desk maintains and what
   * expiry mail reads, so it is the more current of the two. The profile fills the gaps for an
   * account that has no membership yet.
   */
  useEffect(() => {
    if (!visible) return;
    setFormError(null);
    reset({
      firstName: member?.firstName ?? account?.firstName ?? '',
      middleName: member?.middleName ?? account?.middleName ?? '',
      lastName: member?.lastName ?? account?.lastName ?? '',
      email: member?.email ?? account?.email ?? '',
      phone: member?.phone ?? account?.phone ?? '',
      emergencyName: member?.emergencyContact?.name ?? '',
      emergencyPhone: member?.emergencyContact?.phone ?? '',
      notes: member?.notes ?? '',
    });
  }, [visible, account, member, reset]);

  const onSubmit = async (values: FormValues) => {
    setFormError(null);

    const firstName = values.firstName.trim();
    const middleName = values.middleName?.trim() || null;
    const lastName = values.lastName.trim();
    const email = values.email.trim().toLowerCase();
    const phone = normalizePhone(values.phone) ?? values.phone.trim();
    const displayName = composeFullName({ firstName, middleName, lastName });

    try {
      if (member) {
        await updateMember(member.id, {
          firstName,
          middleName,
          lastName,
          // Recomposed on write for the same reason `createMember` composes it: it backs the
          // roster's search box and sort order, so leaving it stale renames the person
          // everywhere except the list you find them in.
          fullName: displayName,
          email,
          phone,
          notes: values.notes?.trim() || undefined,
          emergencyContact: values.emergencyName?.trim()
            ? {
                name: values.emergencyName.trim(),
                phone: values.emergencyPhone?.trim() ?? '',
              }
            : undefined,
        });
      }

      if (account?.uid) {
        /*
         * `email` is deliberately not written here. This field is the sign-in address, owned by
         * Firebase Auth — changing the mirror would make the profile disagree with the
         * credential the member actually types, and only the Admin SDK can move the real one.
         * The membership's email (updated above) is what expiry mail uses, which is the address
         * staff are correcting when they edit this field.
         */
        await upsertUserProfile(account.uid, {
          firstName,
          middleName,
          lastName,
          displayName,
          phone,
        });
      }

      onSaved?.(`Saved changes to ${displayName}.`);
      onClose();
    } catch (error) {
      // Logged as well as shown: a rules rejection here is a deployment problem whose detail
      // belongs in the console, not in a sentence at the front desk.
      console.error('[accounts] edit failed', error);
      setFormError(authErrorMessage(error));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows taps on the sheet so they don't reach the backdrop and dismiss it mid-edit. */}
        <Pressable
          onPress={() => {}}
          style={[styles.sheet, Shadow.card, { backgroundColor: card, borderColor: border }]}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, { color: text }]}>Edit details</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {member
                ? 'Updates both their membership record and their account profile.'
                : 'This account holds no membership yet, so only their profile is updated.'}
            </Text>

            {account?.username ? (
              <Input
                label="Username"
                value={account.username}
                editable={false}
                selectTextOnFocus={false}
                style={{ backgroundColor: surface, color: muted }}
                hint="Permanent. A username is a reservation, so it can't be changed or reused — issue a new account if it must change."
              />
            ) : null}

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
                  hint="Where expiry reminders go. Their sign-in address is set on the account itself and doesn't change here."
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

            {member ? (
              <>
                <Text style={[styles.sectionTitle, { color: text }]}>
                  Emergency contact (optional)
                </Text>
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
              </>
            ) : null}

            {formError ? (
              <Text style={{ color: danger, fontSize: FontSize.sm }}>{formError}</Text>
            ) : null}

            <Button title="Save changes" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />
            <Pressable onPress={onClose} accessibilityRole="button">
              <Text style={[styles.cancel, { color: brand }]}>Cancel</Text>
            </Pressable>
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
    maxWidth: 460,
    maxHeight: '90%',
    alignSelf: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: { padding: Spacing.xl, gap: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  subtitle: { fontSize: FontSize.sm, lineHeight: 19 },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  multiline: { minHeight: 88, paddingTop: Spacing.md, textAlignVertical: 'top' },
  cancel: { fontWeight: FontWeight.semibold, textAlign: 'center', paddingVertical: Spacing.sm },
});
