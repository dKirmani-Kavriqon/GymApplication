import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorText, Field, IconButton, IconTile, Screen, Txt } from '../../components/ui';
import { useSession } from '../../state/session';

export function OtpScreen({ phone, devCode, onBack }: { phone: string; devCode?: string; onBack: () => void }) {
  const { api, signIn } = useSession();
  const [code, setCode] = useState('');
  const [hint, setHint] = useState(devCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(value = code) {
    if (!/^\d{6}$/.test(value)) return setError('Enter the 6-digit code.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyOtp(phone, value);
      await signIn(res.token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const res = await api.requestOtp(phone);
      setHint(res.devCode);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Screen
      testID="otp"
      footer={
        <>
          <Button label="Continue" arrow onPress={() => verify()} loading={busy} testID="verify-code" />
          <Button label="Send a new code" variant="ghost" onPress={resend} />
        </>
      }
    >
      <IconButton icon="arrow-left" label="Change number" onPress={onBack} />
      <View style={{ gap: 10, marginTop: 12 }}>
        <IconTile icon="lock" size={56} />
        <Txt variant="h1" color="heading" accessibilityRole="header">
          Enter the code
        </Txt>
        <Txt variant="body" color="textMuted">
          We sent it to {phone}
        </Txt>
      </View>
      {hint ? (
        <Card testID="dev-code" variant="tint">
          <Txt variant="small" color="textMuted">
            Development build: your code is
          </Txt>
          <Txt variant="h1" color="heading" style={{ letterSpacing: 6 }}>
            {hint}
          </Txt>
        </Card>
      ) : null}
      <Field
        label="6-digit code"
        placeholder="••••••"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(v) => {
          const clean = v.replace(/\D/g, '');
          setCode(clean);
          setError(null);
          if (clean.length === 6) void verify(clean); // auto-submit when the SMS autofills
        }}
      />
      <ErrorText message={error} />
    </Screen>
  );
}
