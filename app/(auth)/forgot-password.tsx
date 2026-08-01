import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
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

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
});

type FormValues = z.infer<typeof schema>;

const initialValues: FormValues = { email: '' };

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const brand = useThemeColor({}, 'brand');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <View style={[styles.flex, { backgroundColor: background }]}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: text }]}>Reset your password</Text>
        <Text style={[styles.subtitle, { color: muted }]}>
          We&apos;ll email you a link to set a new one.
        </Text>

        <Card style={styles.card}>
          {sent ? (
            <Text style={{ color: success }}>
              Check your inbox — if an account exists for that address, a reset link is on its way.
            </Text>
          ) : (
            <Formik
              initialValues={initialValues}
              validate={toFormikValidate(schema)}
              onSubmit={async (values) => {
                setFormError(null);
                try {
                  await resetPassword(values.email);
                  setSent(true);
                } catch (error) {
                  // The real cause is logged by AuthContext; this is the short version.
                  setFormError(authErrorMessage(error));
                }
              }}>
              {({ handleSubmit, isSubmitting }) => (
                <>
                  <FormikField
                    name="email"
                    label="Email"
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    onSubmitEditing={() => handleSubmit()}
                    returnKeyType="go"
                  />

                  {formError ? (
                    <Text style={[styles.error, { color: danger }]}>{formError}</Text>
                  ) : null}

                  <Button
                    title="Send reset link"
                    loading={isSubmitting}
                    onPress={() => handleSubmit()}
                  />
                </>
              )}
            </Formik>
          )}
        </Card>

        <Link href="/(auth)/sign-in" style={[styles.link, { color: brand }]}>
          Back to sign in
        </Link>
      </View>
    </View>
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
  link: { fontWeight: FontWeight.semibold, textAlign: 'center', marginTop: Spacing.sm },
});
