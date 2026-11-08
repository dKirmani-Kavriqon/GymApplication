import React, { useState } from 'react';
import { View } from 'react-native';
import { phoneSchema } from '@gymverse/shared';
import { Button, ErrorText, Field, IconButton, IconTile, Screen, Txt } from '../../components/ui';
import { useSession } from '../../state/session';

/** Normalises what people type: "98765 43210" → "+919876543210". India is the default country. */
export function toE164(input: string): string {
  const digits = input.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return digits;
}

export function PhoneScreen({ onSent, onBack }: { onSent: (phone: string, devCode?: string) => void; onBack: () => void }) {
  const { api } = useSession();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const parsed = phoneSchema.safeParse(toE164(phone));
    if (!parsed.success) return setError('Enter your 10-digit mobile number.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestOtp(parsed.data);
      onSent(parsed.data, res.devCode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="phone" footer={<Button label="Send code" arrow onPress={send} loading={busy} testID="send-code" />}>
      <IconButton icon="arrow-left" label="Back" onPress={onBack} />
      <View style={{ gap: 10, marginTop: 12 }}>
        <IconTile icon="smartphone" size={56} />
        <Txt variant="h1" color="heading" accessibilityRole="header">
          What's your phone number?
        </Txt>
        <Txt variant="body" color="textMuted">
          We'll text you a 6-digit code. No password to remember.
        </Txt>
      </View>
      <Field
        label="Mobile number"
        placeholder="98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          setError(null);
        }}
        onSubmitEditing={send}
      />
      <ErrorText message={error} />
    </Screen>
  );
}
