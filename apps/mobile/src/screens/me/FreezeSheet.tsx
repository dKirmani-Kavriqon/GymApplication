import React, { useState } from 'react';
import { View } from 'react-native';
import { MAX_FREEZE_DAYS, addDays, freezeRequestSchema } from '@gymverse/shared';
import { Button, Chip, ErrorText, Field, Sheet, Stepper, Txt } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useSession } from '../../state/session';
import { useGym } from '../../state/hooks';
import { formatDate, localDayKey } from '../../utils/format';

const REASONS = ['Travel', 'Injury', 'Illness', 'Exams', 'Other'];

/** Pause membership (PRD §6.1 "Freeze membership"): a request the gym approves; approved days are added to the end date. */
export function FreezeSheet({ visible, onClose, onSent, now = () => new Date() }: { visible: boolean; onClose: () => void; onSent: () => void; now?: () => Date }) {
  const { api } = useSession();
  const gym = useGym();
  const toast = useToast();
  const [startIn, setStartIn] = useState(1);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState('Travel');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = localDayKey(now());
  const startsOn = addDays(today, startIn);
  const endsOn = addDays(startsOn, days - 1);

  async function send() {
    const input = { startsOn, endsOn, reason: details.trim() ? `${reason}: ${details.trim()}` : reason };
    const parsed = freezeRequestSchema.safeParse(input);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the dates.');
    setBusy(true);
    setError(null);
    try {
      await api.requestFreeze(gym.id, parsed.data);
      toast.show({ title: 'Pause requested', body: `${gym.name} will confirm soon.`, icon: 'pause-circle' });
      onSent();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Pause membership" testID="freeze-sheet">
      <Txt variant="body" color="textMuted">
        Travelling or injured? Ask your gym to pause your membership. Paused days are added to your end date once approved.
      </Txt>
      <Stepper label="Starts in (days)" a11yLabel="start day" value={startIn} min={0} max={30} onChange={setStartIn} />
      <Stepper label="Pause for (days)" a11yLabel="pause length" value={days} min={1} max={MAX_FREEZE_DAYS} onChange={setDays} />
      <Txt variant="smallStrong" color="primaryText">
        {formatDate(`${startsOn}T12:00:00`)} – {formatDate(`${endsOn}T12:00:00`)}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {REASONS.map((r) => (
          <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <Field label="Anything to add? (optional)" value={details} onChangeText={setDetails} maxLength={200} />
      <ErrorText message={error} />
      <Button label="Send request" arrow onPress={() => void send()} loading={busy} testID="send-freeze" />
    </Sheet>
  );
}
