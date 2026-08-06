import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { useThemeColor } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/Theme';
import { authErrorMessage } from '@/lib/authErrors';
import { db } from '@/lib/firebase';
import {
  createCheckIn,
  createNonMemberCheckIn,
  fetchPricing,
  recordWalkInPayment,
  upsertNonMember,
} from '@/lib/firestore';
import { daysUntil, formatCurrency, formatDate, membershipTone } from '@/lib/format';
import { parsePass, passDisplayName } from '@/lib/nonMembers';
import { pickQrImage, releaseQrImage } from '@/lib/pickQrImage';
import type { Member } from '@/types/models';

/**
 * Two outcomes because the two kinds of pass answer different questions. A member scan is an
 * entitlement check that can fail — expired, frozen, cancelled. A walk-in scan cannot: there is
 * no membership to be lapsed, so logging the visit is the whole operation.
 *
 * The walk-in branch carries the visitor id because the check-in and the day-pass charge are two
 * separate writes: the visit is recorded the moment the code resolves, and the fee is taken after,
 * once the person at the desk has confirmed the amount.
 */
type Result =
  | { kind: 'member'; member: Member; ok: boolean; reason?: string }
  | { kind: 'nonmember'; nonMemberId: string; name: string };

export default function Scan() {
  const { user, isStaff } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walkInPesos, setWalkInPesos] = useState(0);
  const [fee, setFee] = useState('');
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [chargedCents, setChargedCents] = useState<number | null>(null);
  // Separate from `busy` so the upload button shows its own spinner while the camera line
  // underneath keeps saying what the camera is doing.
  const [uploadBusy, setUploadBusy] = useState(false);
  // Guards against the camera firing the same code dozens of times per second.
  const lockRef = useRef(false);

  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');
  const border = useThemeColor({}, 'border');

  /** One read at mount — the default price, which the desk can still override per visit. */
  useEffect(() => {
    let cancelled = false;
    void fetchPricing()
      .then((pricing) => {
        if (!cancelled) setWalkInPesos(pricing.walkInCents / 100);
      })
      .catch((err) => console.error('[pricing] could not load walk-in price', err));
    return () => {
      cancelled = true;
    };
  }, []);

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
          setFee(String(walkInPesos || ''));
          setFeeError(null);
          setChargedCents(null);
          setResult({ kind: 'nonmember', nonMemberId: pass.nonMember.id, name });
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
    [user, walkInPesos]
  );

  /**
   * Decodes a QR out of a picture instead of off the camera — a screenshot the member emailed
   * ahead, a photo of a printed pass, or simply the way in when the camera is denied or absent.
   *
   * The decoded string goes through the same `handleScan`, so an uploaded pass is validated,
   * expiry-checked, and recorded on exactly one code path. Nothing is uploaded anywhere: the
   * image is read locally and the URI is released as soon as it has been decoded.
   */
  const handleUpload = useCallback(async () => {
    setUploadBusy(true);
    setError(null);

    let uri: string | null = null;
    try {
      uri = await pickQrImage();
      if (!uri) return; // Picker dismissed.

      const [found] = await scanFromURLAsync(uri, ['qr']);
      if (!found?.data) {
        throw new Error(
          'No QR code found in that image. Try a sharper photo or a direct screenshot.'
        );
      }

      // `handleScan` refuses to run while the lock is held, and the lock is only released by
      // "Scan next". An upload is an explicit, deliberate action rather than a camera frame
      // arriving unbidden, so it clears the lock first — without this the second upload in a
      // row would be swallowed silently.
      lockRef.current = false;
      await handleScan(found.data);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      if (uri) releaseQrImage(uri);
      setUploadBusy(false);
    }
  }, [handleScan]);

  /**
   * Takes the day-pass fee for a walk-in already logged above.
   *
   * Deliberately a second, explicit step rather than part of the scan: the desk may be comping the
   * visit, charging a different rate, or taking the money after the person is inside, and none of
   * those should hold up the check-in. Nothing is written when the amount is zero — a comp is the
   * absence of a payment, not a ₱0 one.
   */
  const chargeWalkIn = async (nonMemberId: string, name: string) => {
    const pesos = Number(fee.trim());
    if (!Number.isFinite(pesos) || pesos < 0) {
      setFeeError('Enter an amount like 150.');
      return;
    }

    const amountCents = Math.round(pesos * 100);
    if (amountCents === 0) {
      setChargedCents(0);
      setFeeError(null);
      return;
    }

    setFeeBusy(true);
    setFeeError(null);
    try {
      await recordWalkInPayment({
        nonMemberId,
        visitorName: name,
        amountCents,
        method: 'cash',
        recordedBy: user?.uid ?? 'unknown',
      });
      setChargedCents(amountCents);
    } catch (err) {
      console.error('[scan] walk-in payment failed', err);
      setFeeError(authErrorMessage(err));
    } finally {
      setFeeBusy(false);
    }
  };

  const scanAgain = () => {
    setResult(null);
    setError(null);
    setFee('');
    setFeeError(null);
    setChargedCents(null);
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

          {chargedCents === null ? (
            <View style={[styles.feeBox, { borderColor: border }]}>
              <Input
                label="Day-pass fee (₱)"
                placeholder={String(walkInPesos || 0)}
                keyboardType="decimal-pad"
                value={fee}
                onChangeText={setFee}
                error={feeError ?? undefined}
                hint="Enter 0 to comp this visit — nothing is recorded as revenue."
              />
              <Button
                title={feeBusy ? 'Recording…' : 'Record payment'}
                loading={feeBusy}
                onPress={() => void chargeWalkIn(result.nonMemberId, result.name)}
              />
            </View>
          ) : (
            <Text style={{ color: chargedCents > 0 ? success : muted, fontSize: FontSize.sm }}>
              {chargedCents > 0
                ? `${formatCurrency(chargedCents)} recorded — it appears in this month's revenue.`
                : 'Comped. No payment was recorded for this visit.'}
            </Text>
          )}

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
          {/*
            The camera is gated, but the screen is not. Denied permission used to early-return a
            standalone "Camera access" screen, which would have hidden the upload button in the
            one situation it is most needed — no camera, but a screenshot of the pass on hand.
          */}
          {permission?.granted ? (
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
            </>
          ) : (
            <Card style={{ gap: Spacing.md }}>
              <Text style={{ color: muted }}>
                {permission?.canAskAgain === false
                  ? 'Camera permission was denied. Enable it in system settings to scan live, or upload a QR image below.'
                  : 'Allow camera access to scan live, or upload a QR image below.'}
              </Text>
              <Button title="Grant camera access" onPress={() => void requestPermission()} />
            </Card>
          )}

          <Card style={{ gap: Spacing.md }}>
            <Button
              title={uploadBusy ? 'Reading image…' : 'Upload QR image'}
              variant={permission?.granted ? 'secondary' : 'primary'}
              loading={uploadBusy}
              onPress={() => void handleUpload()}
            />
            <Text style={{ color: muted, fontSize: FontSize.sm }}>
              Pick a screenshot or photo of a member pass and it is checked in the same way as a
              live scan. The image stays on this device.
            </Text>
          </Card>

          {error ? (
            <Card style={{ gap: Spacing.md }}>
              <Text style={{ color: danger }}>{error}</Text>
              <Button title="Try again" variant="secondary" onPress={scanAgain} />
            </Card>
          ) : null}
          {Platform.OS === 'web' && permission?.granted ? (
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
  // Boxed so the fee reads as a separate decision from the check-in that already succeeded.
  feeBox: {
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
