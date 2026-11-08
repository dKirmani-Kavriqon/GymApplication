import React, { useState } from 'react';
import { Image, View } from 'react-native';
import type { GymPreview } from '@gymverse/shared';
import { BrandBlob, Button, Card, ErrorText, Field, IconTile, Screen, Txt } from '../../components/ui';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeContext';
import { parseJoinCode } from '../../utils/format';

/**
 * Member onboarding step 1 (PRD §7): find your gym by code or QR link.
 * Scanning the gym's poster with the phone camera opens gymverse://join/CODE,
 * which lands here with the code already filled in and the gym's brand applied.
 */
export function WelcomeScreen({
  initialCode,
  preview,
  onPreview,
  onContinue,
  onHaveAccount,
}: {
  initialCode?: string | null;
  preview: GymPreview | null;
  onPreview: (p: GymPreview | null) => void;
  onContinue: () => void;
  onHaveAccount?: () => void;
}) {
  const { api } = useSession();
  const t = useTheme();
  const [code, setCode] = useState(initialCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    const parsed = parseJoinCode(code);
    if (!parsed) return setError('Gym codes have 6 letters or numbers.');
    setBusy(true);
    setError(null);
    try {
      onPreview(await api.previewGym(parsed));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (preview) {
    return (
      <Screen
        testID="welcome-preview"
        decor={<BrandBlob />}
        footer={
          <>
            <Button label={`Join ${preview.name}`} arrow onPress={onContinue} />
            <Button label="Not my gym" variant="ghost" onPress={() => onPreview(null)} />
          </>
        }
      >
        <View style={{ alignItems: 'center', gap: 14, marginTop: 70 }}>
          {preview.branding.logoUrl ? (
            <Image source={{ uri: preview.branding.logoUrl }} accessibilityLabel={`${preview.name} logo`} style={{ width: 120, height: 120, borderRadius: 36 }} />
          ) : (
            <View style={{ width: 120, height: 120, borderRadius: 36, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="display" color="onPrimary" style={{ fontSize: 56, lineHeight: 64 }}>
                {preview.name.slice(0, 1).toUpperCase()}
              </Txt>
            </View>
          )}
          <Txt variant="display" color="heading" align="center">
            {preview.name}
          </Txt>
          {preview.branding.tagline ? (
            <Txt variant="body" color="textMuted" align="center">
              {preview.branding.tagline}
            </Txt>
          ) : null}
          <Txt variant="smallStrong" color="primaryText">
            {preview.city}
          </Txt>
        </View>
        {preview.branding.welcomeMessage ? (
          <Card variant="tint">
            <Txt variant="body">{preview.branding.welcomeMessage}</Txt>
          </Card>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      testID="welcome"
      decor={<BrandBlob />}
      footer={
        <>
          <Button label="Find my gym" icon="search" onPress={find} loading={busy} testID="find-gym" />
          {onHaveAccount ? <Button label="I already have an account" variant="ghost" onPress={onHaveAccount} /> : null}
        </>
      }
    >
      <View style={{ gap: 12, marginTop: 70, marginBottom: 8 }}>
        <IconTile icon="star" size={56} tone="primary" />
        <Txt variant="display" color="heading" accessibilityRole="header">
          Welcome!
        </Txt>
        <Txt variant="body" color="textMuted">
          Scan the QR code at your gym's front desk, or type the gym code below.
        </Txt>
      </View>
      <Field
        label="Gym code"
        placeholder="e.g. FLEX42"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={60}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setError(null);
        }}
        onSubmitEditing={find}
        returnKeyType="go"
      />
      <ErrorText message={error} />
    </Screen>
  );
}
