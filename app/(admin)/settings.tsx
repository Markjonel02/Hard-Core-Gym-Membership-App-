import { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { httpsCallable } from "firebase/functions";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Screen } from "@/components/ui/Screen";
import { useThemeColor } from "@/components/Themed";
import { useAuth } from "@/context/AuthContext";
import { FontSize, FontWeight, Radius, Spacing } from "@/constants/Theme";
import { useAccountSearch } from "@/hooks/useUsers";
import { authErrorMessage } from "@/lib/authErrors";
import { functions } from "@/lib/firebase";
import { initialsOf } from "@/lib/format";
import { memberDisplayName } from "@/lib/names";
import type { Role } from "@/types/models";

export default function AdminSettings() {
  const { user, profile, role, signOut, refreshRole } = useAuth();

  const text = useThemeColor({}, "text");
  const muted = useThemeColor({}, "muted");
  const brand = useThemeColor({}, "brand");
  const brandMuted = useThemeColor({}, "brandMuted");
  const border = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const success = useThemeColor({}, "success");
  const danger = useThemeColor({}, "danger");

  const [email, setEmail] = useState("");
  const [targetRole, setTargetRole] = useState<Role>("staff");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Type-ahead over the accounts already loaded by the listener, so it costs no extra reads.
   *
   * It matters more than a convenience: `setRole` resolves the email against Firebase Auth
   * and fails outright if nothing matches, so a typo used to come back as a flat "no account
   * exists" with no way to tell a wrong address from a person who never signed up. Showing
   * real matches as you type makes that distinction visible before you press the button.
   */
  const { data: suggestions } = useAccountSearch(email);
  const [picked, setPicked] = useState<string | null>(null);
  // Hidden once the shown address is the one already in the box — nothing left to suggest.
  const showSuggestions =
    suggestions.length > 0 && picked !== email.trim().toLowerCase();

  const displayName = profile?.displayName ?? user?.displayName ?? "Staff";

  const assignRole = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) return setError("Enter the account email.");

    setBusy("role");
    try {
      const call = httpsCallable(functions, "setRole");
      await call({ email: email.trim().toLowerCase(), role: targetRole });
      setMessage(
        `${email.trim()} is now ${targetRole}. They'll see it after signing in again.`,
      );
      setEmail("");
      setPicked(null);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const runExpiryNow = async () => {
    setError(null);
    setMessage(null);
    setBusy("expiry");
    try {
      const call = httpsCallable(functions, "runExpiryScanNow");
      const result = await call({});
      const data = result.data as { sent?: number; expired?: number };
      setMessage(
        `Scan complete — ${data.sent ?? 0} reminder(s) sent, ${data.expired ?? 0} membership(s) marked expired.`,
      );
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const doSignOut = async () => {
    await signOut();
    router.replace("/(auth)/sign-in");
  };

  const confirmSignOut = () => {
    if (Platform.OS === "web") {
      if (window.confirm("Sign out of Hardcore Gym?")) void doSignOut();
      return;
    }
    Alert.alert("Sign out", "Sign out of Hardcore Gym?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => void doSignOut(),
      },
    ]);
  };

  return (
    <Screen title="Settings">
      <Card style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: brandMuted }]}>
          <Text style={[styles.initials, { color: brand }]}>
            {initialsOf(displayName)}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: text }]}>{displayName}</Text>
          <Text style={{ color: muted }}>{user?.email}</Text>
        </View>
        <Badge label={role ?? "staff"} tone="brand" />
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <Text style={[styles.sectionTitle, { color: text }]}>Front desk</Text>
        <Text style={{ color: muted, fontSize: FontSize.sm }}>
          Scan a member&apos;s QR code to record a check-in.
        </Text>
        <Button title="Open QR scanner" onPress={() => router.push("/scan")} />
      </Card>

      {role === "admin" ? (
        <Card style={{ gap: Spacing.md }}>
          <Text style={[styles.sectionTitle, { color: text }]}>
            Team access
          </Text>
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            The account must already exist. Roles are set as custom claims
            server-side — a client can never promote itself.
          </Text>
          <Input
            label="Account email"
            placeholder="staff@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              setPicked(null);
            }}
            hint={
              email.trim().length > 0 && email.trim().length < 3
                ? "Keep typing — matches appear after 3 characters."
                : undefined
            }
          />

          {showSuggestions ? (
            <View
              style={[styles.suggestions, { borderColor: border, backgroundColor: surface }]}>
              {suggestions.map((account, index) => {
                const address = account.email ?? "";
                return (
                  <Pressable
                    key={account.uid}
                    accessibilityRole="button"
                    onPress={() => {
                      setEmail(address);
                      setPicked(address.trim().toLowerCase());
                      setTargetRole(
                        // Pre-select the role they don't have yet: an admin reaching for
                        // someone already staff is almost always promoting them.
                        account.role === "staff" ? "admin" : "staff",
                      );
                    }}
                    style={({ pressed }) => [
                      styles.suggestion,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: border,
                      },
                      pressed && { backgroundColor: brandMuted },
                    ]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={[styles.suggestionEmail, { color: text }]}
                        numberOfLines={1}>
                        {address || "No email on file"}
                      </Text>
                      <Text
                        style={{ color: muted, fontSize: FontSize.xs }}
                        numberOfLines={1}>
                        {memberDisplayName(account)}
                        {account.username ? ` · @${account.username}` : ""}
                      </Text>
                    </View>
                    <Badge label={account.role ?? "member"} tone="neutral" />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.roleRow}>
            {(["member", "staff", "admin"] as Role[]).map((r) => (
              <Button
                key={r}
                title={r}
                variant={targetRole === r ? "primary" : "ghost"}
                fullWidth={false}
                style={styles.roleButton}
                onPress={() => setTargetRole(r)}
              />
            ))}
          </View>
          <Button
            title="Assign role"
            loading={busy === "role"}
            onPress={() => void assignRole()}
          />
        </Card>
      ) : null}

      {role === "admin" ? (
        <Card style={{ gap: Spacing.md }}>
          <Text style={[styles.sectionTitle, { color: text }]}>
            Expiry reminders
          </Text>
          <Text style={{ color: muted, fontSize: FontSize.sm }}>
            Runs automatically every morning, emailing members 90, 30, and 7
            days before their membership ends. Running it manually is safe —
            members already emailed for a given milestone are skipped.
          </Text>
          <Button
            title="Run expiry scan now"
            variant="secondary"
            loading={busy === "expiry"}
            onPress={() => void runExpiryNow()}
          />
        </Card>
      ) : null}

      {message ? <Text style={{ color: success }}>{message}</Text> : null}
      {error ? <Text style={{ color: danger }}>{error}</Text> : null}

      <Button
        title="Refresh my permissions"
        variant="ghost"
        onPress={() => void refreshRole()}
      />
      <Button title="Sign out" variant="danger" onPress={confirmSignOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  name: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  suggestions: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  suggestionEmail: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  roleRow: { flexDirection: "row", gap: Spacing.sm },
  roleButton: { flex: 1, paddingHorizontal: Spacing.sm },
});
