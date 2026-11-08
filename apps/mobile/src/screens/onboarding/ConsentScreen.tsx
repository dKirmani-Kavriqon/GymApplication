import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { CURRENT_TERMS_VERSION } from '@gymverse/shared';
import { Button, Card, ErrorText, Field, IconTile, Screen, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeContext';

export const TERMS_URL = 'https://gymverse.app/terms';
export const PRIVACY_URL = 'https://gymverse.app/privacy';

function Check({ label, checked, onToggle, testID }: { label: string; checked: boolean; onToggle: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 48, paddingVertical: 6 }}
    >
      <View style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: checked ? t.primary : t.border, backgroundColor: checked ? t.primary : t.surface, alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Icon name="check" size={16} color={t.onPrimary} /> : null}
      </View>
      <Txt variant="body" style={{ flex: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * Consent (India DPDP Act + app stores): terms and privacy, and a guardian's consent for members
 * under 18. Shown after set-up, and again when the terms version changes.
 */
export function ConsentScreen() {
  const { api, me, refreshMe } = useSession();
  const needsGuardian = !!me?.consent?.needsGuardian;
  const [agree, setAgree] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (!agree) return setError('Please agree to the terms to continue.');
    if (needsGuardian && (!guardian || !guardianName.trim())) return setError("A parent or guardian needs to agree, and we need their name.");
    setBusy(true);
    setError(null);
    try {
      await api.acceptConsent({ termsVersion: CURRENT_TERMS_VERSION, ...(needsGuardian ? { guardianConsent: true, guardianName: guardianName.trim() } : {}) });
      await refreshMe();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen testID="consent" footer={<Button label="Agree and continue" arrow onPress={accept} loading={busy} testID="consent-accept" />}>
      <View style={{ gap: 10, marginTop: 24 }}>
        <IconTile icon="shield" size={56} />
        <Txt variant="h1" color="heading" accessibilityRole="header">
          Your data, your choice
        </Txt>
        <Txt variant="body" color="textMuted">
          Your gym sees your visits, bookings and payments. Your progress photos and body stats stay private unless you share them. Health data is never sold or used for ads. You can download or delete your data any time in Settings.
        </Txt>
      </View>
      <Card style={{ gap: 4 }}>
        <Check testID="agree-terms" label="I agree to the Terms of Use and Privacy Policy" checked={agree} onToggle={() => setAgree((v) => !v)} />
        <View style={{ flexDirection: 'row', gap: 16, paddingLeft: 38 }}>
          <Button label="Read terms" variant="ghost" size="sm" full={false} onPress={() => void Linking.openURL(TERMS_URL)} />
          <Button label="Read privacy policy" variant="ghost" size="sm" full={false} onPress={() => void Linking.openURL(PRIVACY_URL)} />
        </View>
      </Card>
      {needsGuardian ? (
        <Card variant="tint" style={{ gap: 10 }} testID="guardian">
          <Txt variant="bodyStrong">You're under 18, so a parent or guardian needs to agree too.</Txt>
          <Field label="Parent or guardian's name" value={guardianName} onChangeText={setGuardianName} autoComplete="name" />
          <Check label="My parent or guardian has read and agrees to the terms" checked={guardian} onToggle={() => setGuardian((v) => !v)} />
        </Card>
      ) : null}
      <ErrorText message={error} />
    </Screen>
  );
}
