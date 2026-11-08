import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { LANGUAGES, type Language } from '@gymverse/shared';
import { Button, Card, ErrorText, Field, ListRow, Screen, Segmented, Sheet, Stepper, ToggleRow, Txt } from '../../components/ui';
import { ThemePicker } from '../../components/ThemePicker';
import { useToast } from '../../components/Toast';
import { useSession } from '../../state/session';
import { useSaveProfile } from '../../state/hooks';
import { useNav } from '../../navigation/Nav';
import { authenticate, biometricAvailable, isLockEnabled, setLockEnabled } from '../../utils/biometric';

/** Settings (FitBody gap): profile, theme, weekly goal, reminders, language, privacy, security. */
export function SettingsScreen() {
  const { me, api, signOut } = useSession();
  const nav = useNav();
  const save = useSaveProfile();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [lock, setLock] = useState(false);

  useEffect(() => {
    void biometricAvailable().then(setBioAvailable);
    void isLockEnabled().then(setLock);
  }, []);

  if (!me) return null;
  const p = me.profile;

  async function update(patch: Parameters<typeof save>[0]) {
    setError(null);
    try {
      await save(patch);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleLock(on: boolean) {
    if (on && !(await authenticate('Turn on app lock'))) return;
    await setLockEnabled(on);
    setLock(on);
    toast.show({ title: on ? 'App lock on' : 'App lock off', icon: 'lock' });
  }

  return (
    <Screen title="Settings" onBack={nav.pop} testID="settings">
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="user" title="Profile" subtitle="Name, body stats, goal and activity level" onPress={() => nav.push('EditProfile')} />
      </Card>

      <Card>
        <ThemePicker />
      </Card>

      <Card style={{ gap: 10 }}>
        <Txt variant="caption" color="textMuted">
          Weekly goal
        </Txt>
        <Txt variant="small" color="textMuted">
          How many days a week you want to visit the gym.
        </Txt>
        <Stepper label="Visits per week" value={p.weeklyGoal} min={1} max={7} onChange={(v) => void update({ weeklyGoal: v })} />
      </Card>

      <Card style={{ gap: 0 }}>
        <Txt variant="caption" color="textMuted">
          Notifications
        </Txt>
        <ToggleRow label="Class reminders" description="An hour before a class you booked" value={p.notifyClassReminders} onChange={(v) => void update({ notifyClassReminders: v })} />
        <ToggleRow label="Workout reminders" description="On days you usually train" value={p.notifyWorkoutReminders} onChange={(v) => void update({ notifyWorkoutReminders: v })} />
        <ToggleRow label="Gym announcements" description="Timings, offers and events" value={p.notifyAnnouncements} onChange={(v) => void update({ notifyAnnouncements: v })} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Txt variant="caption" color="textMuted">
          Language
        </Txt>
        <Segmented<Language> testID="language" value={p.language} onChange={(v) => void update({ language: v })} options={LANGUAGES.map((l) => ({ id: l.id, label: l.label }))} />
      </Card>

      <Card style={{ gap: 0 }}>
        <Txt variant="caption" color="textMuted">
          Privacy & security
        </Txt>
        <ToggleRow label="Show my stats to others" description="Your name and progress on challenge leaderboards" value={p.showStats} onChange={(v) => void update({ showStats: v })} />
        {bioAvailable ? (
          <ToggleRow label="Lock with Face ID / fingerprint" description="Ask every time the app opens" value={lock} onChange={(v) => void toggleLock(v)} testID="biometric-toggle" />
        ) : (
          <View style={{ minHeight: 48, justifyContent: 'center' }}>
            <Txt variant="small" color="textMuted">
              App lock needs Face ID or a fingerprint set up on this phone.
            </Txt>
          </View>
        )}
      </Card>

      <Card style={{ gap: 4 }}>
        <Txt variant="caption" color="textMuted">
          Your data
        </Txt>
        <ListRow icon="download" title="Download my data" subtitle="Everything we store about you, as a file" onPress={() => void exportData()} testID="export-data" />
        <ListRow icon="trash-2" title="Delete my account" subtitle="Removes your profile and history for good" onPress={() => setDeleteOpen(true)} danger testID="delete-account" />
      </Card>

      <ErrorText message={error} />
      <Button label="Redo set-up questions" variant="ghost" onPress={() => nav.push('EditProfile', { wizard: true })} />
      <Txt variant="small" color="textMuted" align="center">
        GymVerse 0.3 · {me.user.phone}
      </Txt>

      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete your account?" testID="delete-sheet">
        <Txt variant="body">
          This permanently deletes your profile, check-ins, bookings, workouts, measurements and messages. Your posts are kept but shown as "Deleted member". Payment receipts stay with your gym for their accounts. This can't be undone.
        </Txt>
        <Field label="Type DELETE to confirm" autoCapitalize="characters" value={confirmText} onChangeText={setConfirmText} />
        <ErrorText message={deleteError} />
        <Button label="Delete my account" variant="danger" icon="trash-2" disabled={confirmText.trim() !== 'DELETE'} loading={deleting} onPress={() => void deleteAccount()} />
        <Button label="Keep my account" variant="ghost" onPress={() => setDeleteOpen(false)} />
      </Sheet>
    </Screen>
  );

  async function exportData() {
    try {
      const data = await api.exportAccount();
      await Share.share({ title: 'My GymVerse data', message: JSON.stringify(data, null, 2) });
    } catch (err) {
      toast.show({ title: "Couldn't prepare your data", body: (err as Error).message, icon: 'alert-circle' });
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteAccount();
      setDeleteOpen(false);
      await signOut();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }
}
