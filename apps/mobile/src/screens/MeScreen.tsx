import React, { useState } from 'react';
import { FreezeSheet } from './me/FreezeSheet';
import { View } from 'react-native';
import { GOALS, formatInr, labelOf } from '@gymverse/shared';
import { Avatar, Button, Card, Divider, ListRow, ProgressBar, Screen, Txt } from '../components/ui';
import { ThemePicker } from '../components/ThemePicker';
import { useSession } from '../state/session';
import { useFeature, useGym } from '../state/hooks';
import { useNav } from '../navigation/Nav';
import { useTheme } from '../theme/ThemeContext';
import { formatDate } from '../utils/format';
import { useLoad } from '../utils/useLoad';

/** Profile, membership, personal theme and the doorway to everything account-related. */
export function MeScreen({ paidVersion = 0 }: { paidVersion?: number }) {
  const { api, me, selectGym, signOut } = useSession();
  const gym = useGym();
  const nav = useNav();
  const t = useTheme();
  const has = { payments: useFeature('payments'), progress: useFeature('progress'), support: useFeature('support') };
  const { data: summary } = useLoad(() => api.summary(gym.id), `${gym.id}:${paidVersion}`);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeVersion, setFreezeVersion] = useState(0);
  const { data: freezes } = useLoad(() => (has.payments ? api.freezeRequests(gym.id) : Promise.resolve({ requests: [] })), `${gym.id}:${freezeVersion}`);
  const { data: history } = useLoad(() => (has.payments ? api.payments(gym.id) : Promise.resolve({ payments: [] })), `${gym.id}:${paidVersion}`);
  if (!me) return null;
  const m = summary?.membership;
  const goal = labelOf(GOALS, me.profile.goal);
  const total = m?.planName && m.endsAt ? Math.max(m.daysLeft, 1) : 0;

  return (
    <Screen testID="me">
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={{ borderRadius: 60, borderWidth: 4, borderColor: t.surface }}>
          <Avatar name={me.user.name} size={92} color={me.profile.themeColor ?? t.primary} />
        </View>
        <Txt variant="h1" color="heading">
          {me.user.name ?? 'You'}
        </Txt>
        <Txt variant="small" color="textMuted">
          {[goal, me.user.phone].filter(Boolean).join(' · ')}
        </Txt>
        {me.profile.bio ? (
          <Txt variant="body" color="textMuted" align="center">
            {me.profile.bio}
          </Txt>
        ) : null}
        <Button label="Edit profile" variant="outline" size="sm" full={false} icon="edit-2" onPress={() => nav.push('EditProfile')} />
      </View>

      {has.payments ? (
        <Card testID="membership-card" style={{ gap: 10 }}>
          <Txt variant="caption" color="textMuted">
            Membership · {gym.name}
          </Txt>
          {m ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <Txt variant="h2" color="heading">
                  {m.state === 'none' ? 'No plan yet' : m.state === 'expired' ? 'Expired' : `${m.daysLeft} days left`}
                </Txt>
                {m.planName ? <Txt variant="bodyStrong" color="primaryText">{m.planName}</Txt> : null}
              </View>
              {m.endsAt && m.state !== 'expired' ? <ProgressBar value={Math.min(1, m.daysLeft / Math.max(total, 30))} label="Membership time left" /> : null}
              {m.planName && m.endsAt ? (
                <Txt variant="small" color="textMuted">
                  {m.state === 'expired' ? 'Ended' : 'Renews'} {formatDate(m.endsAt)}
                </Txt>
              ) : null}
            </>
          ) : null}
          <Button label={m?.state === 'active' ? 'Extend membership' : 'Renew now'} icon="credit-card" arrow onPress={nav.openRenew} />
          {(() => {
            const pending = freezes?.requests.find((r) => r.status === 'pending');
            if (pending) {
              return (
                <Txt variant="smallStrong" color="warning" testID="freeze-pending">
                  Pause requested for {pending.days} days · waiting for {gym.name}
                </Txt>
              );
            }
            return m && (m.state === 'active' || m.state === 'expiring') ? (
              <Button label="Pause membership" variant="outline" size="md" icon="pause-circle" onPress={() => setFreezeOpen(true)} />
            ) : null;
          })()}
          {history?.payments
            .filter((p) => p.status === 'paid')
            .slice(0, 3)
            .map((p) => (
              <Txt key={p.id} variant="small" color="textMuted">
                Receipt {p.receiptNumber} · {p.planName} · {formatInr(p.amountPaise)}
              </Txt>
            ))}
        </Card>
      ) : null}

      <Card>
        <ThemePicker />
      </Card>

      <Card style={{ gap: 0, paddingVertical: 8 }}>
        {has.progress ? <ListRow icon="trending-up" title="Progress" subtitle="Charts, body stats, badges" onPress={() => nav.push('Progress')} /> : null}
        <ListRow icon="heart" title="Favourites" subtitle="Saved workouts, articles and recipes" onPress={() => nav.push('Favourites')} />
        <ListRow icon="bell" title="Notifications" onPress={() => nav.push('Notifications')} />
        {has.support ? <ListRow icon="life-buoy" title="Help & support" subtitle="FAQs and messages with your gym" onPress={() => nav.push('Support')} /> : null}
        <ListRow icon="settings" title="Settings" subtitle="Goal, reminders, language, security" onPress={() => nav.push('Settings')} />
      </Card>

      {me.memberships.length > 1 ? (
        <Card style={{ gap: 8 }}>
          <Txt variant="caption" color="textMuted">
            My gyms
          </Txt>
          {me.memberships.map((mm, i) => (
            <View key={mm.gym.id} style={{ gap: 8 }}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                icon="home"
                title={mm.gym.name}
                subtitle={mm.gym.id === gym.id ? 'Current gym' : `Switch to ${mm.gym.name}`}
                onPress={mm.gym.id === gym.id ? undefined : () => selectGym(mm.gym.id)}
                testID={`gym-${mm.gym.id}`}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <Button label="Log out" variant="danger" icon="log-out" onPress={signOut} />
      <FreezeSheet visible={freezeOpen} onClose={() => setFreezeOpen(false)} onSent={() => setFreezeVersion((v) => v + 1)} />
    </Screen>
  );
}
