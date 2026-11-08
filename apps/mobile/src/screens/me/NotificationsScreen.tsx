import React from 'react';
import { Pressable, View } from 'react-native';
import type { AppNotification, NotificationKind } from '@gymverse/shared';
import { Button, Card, EmptyState, ErrorText, IconTile, Skeleton, Screen, Txt } from '../../components/ui';
import type { IconName } from '../../components/Icon';
import { useSession } from '../../state/session';
import { useGym } from '../../state/hooks';
import { openLink, useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { useLoad } from '../../utils/useLoad';

const ICONS: Record<NotificationKind, IconName> = {
  announcement: 'volume-2',
  booking: 'calendar',
  waitlist_promoted: 'check-circle',
  payment: 'credit-card',
  membership_expiring: 'clock',
  routine_assigned: 'activity',
  challenge: 'flag',
  support_reply: 'message-circle',
  workout_reminder: 'bell',
  class_reminder: 'clock',
  freeze_decision: 'pause-circle',
  system: 'info',
};

export function timeAgo(iso: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** In-app notification centre (FitBody gap). Push delivery comes later (FCM/APNs). */
export function NotificationsScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { api } = useSession();
  const gym = useGym();
  const nav = useNav();
  const t = useTheme();
  const { data, error, loading, reload, setData } = useLoad(() => api.notifications(gym.id), gym.id);

  async function open(n: AppNotification) {
    if (!n.read) {
      setData((prev) => (prev ? { unread: Math.max(0, prev.unread - 1), notifications: prev.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) } : prev));
      void api.markRead(gym.id, [n.id]).catch(() => undefined);
    }
    openLink(nav, n.link);
  }

  async function markAll() {
    setData((prev) => (prev ? { unread: 0, notifications: prev.notifications.map((x) => ({ ...x, read: true })) } : prev));
    await api.markRead(gym.id).catch(() => undefined);
  }

  return (
    <Screen
      title="Notifications"
      onBack={nav.pop}
      testID="notifications"
      refreshing={loading}
      onRefresh={reload}
      right={data && data.unread > 0 ? <Button label="Mark all read" variant="ghost" size="sm" full={false} onPress={markAll} /> : undefined}
    >
      {!data ? (
        error ? <ErrorText message={error} /> : <Skeleton />
      ) : data.notifications.length === 0 ? (
        <EmptyState icon="bell" title="You're all caught up" body="Bookings, messages from your coach and gym news will show up here." />
      ) : (
        data.notifications.map((n, i) => (
          <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`} onPress={() => void open(n)}>
            <Card index={i} testID={`notification-${n.id}`} style={{ flexDirection: 'row', gap: 12, backgroundColor: n.read ? t.surface : t.tint, borderColor: n.read ? t.border : t.tint2 }}>
              <IconTile icon={ICONS[n.kind] ?? 'bell'} size={42} tone={n.read ? 'tint' : 'primary'} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">{n.title}</Txt>
                {n.body ? (
                  <Txt variant="small" color="textMuted">
                    {n.body}
                  </Txt>
                ) : null}
                <Txt variant="small" color="textMuted" style={{ fontSize: 11 }}>
                  {timeAgo(n.createdAt, now())}
                </Txt>
              </View>
              {!n.read ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.primary, marginTop: 6 }} /> : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
