import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
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

const schema = z
  .object({
    name: z.string().min(2, 'Enter your full name'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email'),
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

const initialValues: FormValues = { name: '', email: '', password: '', confirm: '' };

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
              await signUp(values.name, values.email, values.password);
              router.replace('/');
            } catch (error) {
              // The real cause is logged by AuthContext; this is the short version.
              setFormError(authErrorMessage(error));
            }
          }}>
          {({ handleSubmit, isSubmitting }) => (
            <Card style={styles.card}>
              <FormikField
                name="name"
                label="Full name"
                placeholder="Juan Dela Cruz"
                autoComplete="name"
              />

              <FormikField
                name="email"
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                hint="Expiry reminders are sent here."
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, textAlign: 'center' },
  subtitle: { fontSize: FontSize.md, textAlign: 'center', marginBottom: Spacing.sm },
  card: { gap: Spacing.lg },
  error: { fontSize: FontSize.sm },
  link: { fontWeight: FontWeight.semibold },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.sm },
});
