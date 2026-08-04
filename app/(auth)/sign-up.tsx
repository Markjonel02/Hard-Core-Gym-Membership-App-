import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Formik } from 'formik';
import { toFormikValidate } from 'zod-formik-adapter';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormikField } from '@/components/ui/FormikField';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Spacing } from '@/constants/Theme';
import { authErrorMessage } from '@/lib/authErrors';
import { isValidPhone, PHONE_ERROR, PHONE_HINT } from '@/lib/phone';
import { USERNAME_HINT, validateUsername } from '@/lib/usernameRules';

const schema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    // Optional in the truest sense: blank is valid and is stored as null, not "".
    middleName: z.string().optional(),
    lastName: z.string().min(1, 'Last name is required'),
    // The rules live in lib/username so the same check runs here and before reservation.
    username: z.string().superRefine((value, ctx) => {
      const problem = validateUsername(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
    email: z.string().min(1, 'Email is required').email('Enter a valid email'),
    phone: z.string().min(1, 'Phone number is required').refine(isValidPhone, PHONE_ERROR),
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

const initialValues: FormValues = {
  firstName: '',
  middleName: '',
  lastName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  confirm: '',
};

export default function SignUp() {
  const { signUp } = useAuth();
  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const danger = useThemeColor({}, 'danger');
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.flex, { backgroundColor: background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.center}>
          <Text style={[styles.title, { color: text }]}>Create your account</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            Your membership is linked by the front desk once you join.
          </Text>

          <Formik
            initialValues={initialValues}
            validate={toFormikValidate(schema)}
            onSubmit={async (values) => {
              setFormError(null);
              try {
                await signUp({
                  username: values.username,
                  firstName: values.firstName,
                  middleName: values.middleName,
                  lastName: values.lastName,
                  email: values.email,
                  phone: values.phone,
                  password: values.password,
                });
                // Not the dashboard — the verification gate decides when they get in.
                router.replace('/verify-email');
              } catch (error) {
                // The real cause is logged by AuthContext; this is the short version.
                setFormError(authErrorMessage(error));
              }
            }}>
            {({ handleSubmit, isSubmitting }) => (
              <Card style={styles.card}>
                <Text style={[styles.sectionLabel, { color: muted }]}>Your name</Text>

                <FormikField
                  name="firstName"
                  label="First name"
                  placeholder="Juan"
                  autoComplete="given-name"
                />

                <FormikField
                  name="middleName"
                  label="Middle name (optional)"
                  placeholder="Santos"
                  autoComplete="additional-name"
                />

                <FormikField
                  name="lastName"
                  label="Last name"
                  placeholder="Dela Cruz"
                  autoComplete="family-name"
                />

                <Text style={[styles.sectionLabel, { color: muted }]}>Sign-in details</Text>

                <FormikField
                  name="username"
                  label="Username"
                  placeholder="juan.delacruz"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  hint={USERNAME_HINT}
                />

                <FormikField
                  name="email"
                  label="Email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  hint="We'll send a confirmation link here."
                />

                <FormikField
                  name="phone"
                  label="Phone number"
                  placeholder="0917 123 4567"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  hint={PHONE_HINT}
                />

                <FormikField
                  name="password"
                  label="Password"
                  placeholder="At least 8 characters"
                  secureTextEntry
                  autoComplete="new-password"
                />

                <FormikField
                  name="confirm"
                  label="Confirm password"
                  secureTextEntry
                  autoComplete="new-password"
                />

                {formError ? (
                  <Text style={[styles.error, { color: danger }]}>{formError}</Text>
                ) : null}

                <Button
                  title="Create account"
                  loading={isSubmitting}
                  onPress={() => handleSubmit()}
                />
              </Card>
            )}
          </Formik>

          <View style={styles.footer}>
            <Text style={{ color: muted }}>Already have an account? </Text>
            <Link href="/(auth)/sign-in" style={[styles.link, { color: brand }]}>
              Sign in
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  center: {
    padding: Spacing.lg,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, textAlign: 'center' },
  subtitle: { fontSize: FontSize.md, textAlign: 'center', marginBottom: Spacing.sm },
  card: { gap: Spacing.lg },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  error: { fontSize: FontSize.sm },
  link: { fontWeight: FontWeight.semibold },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.sm },
});
