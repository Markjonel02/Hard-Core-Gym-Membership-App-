import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { authErrorMessage } from '@/lib/authErrors';
import { db } from '@/lib/firebase';
import { createCheckIn, createNonMemberCheckIn, upsertNonMember } from '@/lib/firestore';
import { daysUntil, formatDate, membershipTone } from '@/lib/format';
import { parsePass, passDisplayName } from '@/lib/nonMembers';
import type { Member } from '@/types/models';

/**
 * Two outcomes because the two kinds of pass answer different questions. A member scan is an
 * entitlement check that can fail — expired, frozen, cancelled. A walk-in scan cannot: there is
 * no membership to be lapsed, so logging the visit is the whole operation.
 */
type Result =
  | { kind: 'member'; member: Member; ok: boolean; reason?: string }
  | { kind: 'nonmember'; name: string };

export default function Scan() {
  const { user, isStaff } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against the camera firing the same code dozens of times per second.
  const lockRef = useRef(false);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');
  const border = useThemeColor({}, 'border');

  const handleScan = useCallback(
    async (raw: string) => {
      if (lockRef.current) return;
      lockRef.current = true;
      setBusy(true);
      setError(null);

      try {
        const pass = parsePass(raw);
        if (!pass) throw new Error('That QR code is not a Hardcore Gym pass.');

        if (pass.kind === 'nonmember') {
          const name = passDisplayName(pass.nonMember);
          // The visitor's device could not write this — it has no auth session — so the staff
          // client creates the record here. Merging on their pass id means a repeat visitor
          // bumps their own counter instead of appearing as a second person.
          await upsertNonMember(pass.nonMember);
          await createNonMemberCheckIn(pass.nonMember.id, name, user?.uid ?? 'unknown');
          setResult({ kind: 'nonmember', name });
          return;
        }

        const snap = await getDoc(doc(db, 'members', pass.memberId));
        if (!snap.exists()) throw new Error('Member not found.');
        const member = { id: snap.id, ...snap.data() } as Member;

        const days = daysUntil(member.endDate);
        if (member.status !== 'active') {
          setResult({ kind: 'member', member, ok: false, reason: `Membership is ${member.status}.` });
          return;
        }
        if (days !== null && days < 0) {
          setResult({ kind: 'member', member, ok: false, reason: 'Membership has expired.' });
          return;
        }

        await createCheckIn(member.id, member.fullName, user?.uid ?? 'unknown');
        setResult({ kind: 'member', member, ok: true });
      } catch (err) {
        setError(authErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [user]
  );

  const scanAgain = () => {
    setResult(null);
    setError(null);
    lockRef.current = false;
  };

  if (!isStaff) {
    return (
      <Screen>
        <Card>
          <Text style={{ color: text }}>Only staff can scan gym passes.</Text>
        </Card>
      </Screen>
    );
  }

  if (!permission?.granted) {
    return (
      <Screen title="Camera access">
        <Card style={{ gap: Spacing.md }}>
          <Text style={{ color: muted }}>
            {permission?.canAskAgain === false
              ? 'Camera permission was denied. Enable it in system settings to scan passes.'
              : 'Allow camera access to scan member QR codes.'}
          </Text>
          <Button title="Grant camera access" onPress={() => void requestPermission()} />
          <Button title="Close" variant="ghost" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {result?.kind === 'nonmember' ? (
        <Card style={{ gap: Spacing.md }}>
          <Text style={[styles.resultTitle, { color: success }]}>Walk-in logged</Text>
          <Text style={[styles.memberName, { color: text }]}>{result.name}</Text>
          <View style={styles.metaRow}>
            <Badge label="Non-member" tone="neutral" />
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              Recorded in the attendance log. No membership is attached to this pass.
            </Text>
          </View>
          <Button title="Scan next pass" onPress={scanAgain} />
          <Button
            title="View attendance"
            variant="secondary"
            onPress={() => router.replace('/(admin)/attendance')}
          />
        </Card>
      ) : result ? (
        <Card style={{ gap: Spacing.md }}>
          <Text
            style={[styles.resultTitle, { color: result.ok ? success : danger }]}>
            {result.ok ? 'Checked in' : 'Entry blocked'}
          </Text>
          <Text style={[styles.memberName, { color: text }]}>{result.member.fullName}</Text>
          <View style={styles.metaRow}>
            <Badge
              label={result.member.status}
              tone={membershipTone(result.member.status, daysUntil(result.member.endDate))}
            />
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              {result.member.planName} · expires {formatDate(result.member.endDate)}
            </Text>
          </View>
          {result.reason ? <Text style={{ color: danger }}>{result.reason}</Text> : null}
          <Button title="Scan next member" onPress={scanAgain} />
          <Button
            title="View member"
            variant="secondary"
            onPress={() => router.replace(`/(admin)/members/${result.member.id}`)}
          />
        </Card>
      ) : (
        <>
          <View style={[styles.cameraFrame, { borderColor: border }]}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => void handleScan(data)}
            />
          </View>
          <Text style={{ color: muted, textAlign: 'center' }}>
            {busy ? 'Checking…' : 'Point the camera at a member or walk-in QR pass.'}
          </Text>
          {error ? (
            <Card style={{ gap: Spacing.md }}>
              <Text style={{ color: danger }}>{error}</Text>
              <Button title="Try again" variant="secondary" onPress={scanAgain} />
            </Card>
          ) : null}
          {Platform.OS === 'web' ? (
            <Text style={{ color: muted, fontSize: FontSize.sm, textAlign: 'center' }}>
              Web scanning needs an HTTPS origin or localhost.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: {
    aspectRatio: 1,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  camera: { flex: 1 },
  resultTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  memberName: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  metaRow: { gap: Spacing.sm },
});
