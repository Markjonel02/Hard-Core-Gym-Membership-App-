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

const schema = z.object({
  // Deliberately loose: this box takes a username *or* an email, so the only thing worth
  // rejecting client-side is emptiness. Anything else is a credential error, and telling the
  // user which half was wrong would leak whether an account exists.
  identifier: z.string().min(1, 'Enter your username or email'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

const initialValues: FormValues = { identifier: '', password: '' };

export default function SignIn() {
  const { signIn } = useAuth();
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
        <View style={styles.brandBlock}>
          <Text style={[styles.logo, { color: brand }]}>HARDCORE</Text>
          <Text style={[styles.logoSub, { color: text }]}>GYM</Text>
          <Text style={[styles.tagline, { color: muted }]}>Members area</Text>
        </View>

        <Formik
          initialValues={initialValues}
          validate={toFormikValidate(schema)}
          onSubmit={async (values) => {
            setFormError(null);
            try {
              await signIn(values.identifier, values.password);
              router.replace('/');
            } catch (error) {
              // The real cause is logged by AuthContext; this is the short version.
              setFormError(authErrorMessage(error));
            }
          }}>
          {({ handleSubmit, isSubmitting }) => (
            <Card style={styles.card}>
              <FormikField
                name="identifier"
                label="Username or email"
                placeholder="juan.delacruz or you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                keyboardType="email-address"
              />

              <FormikField
                name="password"
                label="Password"
                placeholder="••••••••"
                secureTextEntry
                autoComplete="current-password"
                onSubmitEditing={() => handleSubmit()}
                returnKeyType="go"
              />

              {formError ? (
                <Text style={[styles.error, { color: danger }]}>{formError}</Text>
              ) : null}

              <Button title="Sign in" loading={isSubmitting} onPress={() => handleSubmit()} />

              <Link href="/(auth)/forgot-password" style={[styles.link, { color: brand }]}>
                Forgot password?
              </Link>
            </Card>
          )}
        </Formik>

        <View style={styles.footer}>
          <Text style={{ color: muted }}>New here? </Text>
          <Link href="/(auth)/sign-up" style={[styles.link, { color: brand }]}>
            Create an account
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
    gap: Spacing.xl,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  brandBlock: { alignItems: 'center', gap: 2 },
  logo: { fontSize: FontSize.display, fontWeight: FontWeight.bold, letterSpacing: 2 },
  logoSub: { fontSize: FontSize.xl, fontWeight: FontWeight.semibold, letterSpacing: 8 },
  tagline: { fontSize: FontSize.md, marginTop: Spacing.sm },
  card: { gap: Spacing.lg },
  error: { fontSize: FontSize.sm },
  link: { fontWeight: FontWeight.semibold, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center' },
});
