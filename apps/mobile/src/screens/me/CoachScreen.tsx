import React from 'react';
import { Pressable, View } from 'react-native';
import type { Attendee } from '@gymverse/shared';
import { Avatar, Card, EmptyState, ErrorText, Skeleton, Pill, Screen, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useSession } from '../../state/session';
import { useGym } from '../../state/hooks';
import { useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { formatClassTime } from '../../utils/format';
import { tapFeedback } from '../../utils/feedback';
import { useLoad } from '../../utils/useLoad';

/** Trainer tools in the same app (PRD §6.2): today's classes, mark attendance with one tap. */
export function CoachScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { api } = useSession();
  const gym = useGym();
  const nav = useNav();
  const t = useTheme();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(() => api.trainerToday(gym.id), gym.id);

  async function mark(classId: string, a: Attendee) {
    const next = a.attended !== true;
    const patch = (attended: boolean | null) =>
      setData((prev) =>
        prev
          ? { classes: prev.classes.map((c) => (c.id !== classId ? c : { ...c, attendees: c.attendees.map((x) => (x.userId === a.userId ? { ...x, attended } : x)) })) }
          : prev,
      );
    patch(next);
    try {
      await api.markAttendance(gym.id, classId, a.userId, next);
    } catch (err) {
      patch(a.attended);
      toast.show({ title: "Couldn't save attendance", body: (err as Error).message, icon: 'alert-circle' });
    }
  }

  return (
    <Screen title="Today's classes" onBack={nav.pop} refreshing={loading} onRefresh={reload} testID="coach">
      {!data ? (
        error ? <ErrorText message={error} /> : <Skeleton />
      ) : data.classes.length === 0 ? (
        <EmptyState icon="calendar" title="No classes today" body="Classes you run will show here with their attendee list." />
      ) : (
        data.classes.map((c, i) => {
          const present = c.attendees.filter((a) => a.attended).length;
          const booked = c.attendees.filter((a) => a.status === 'booked');
          return (
            <Card key={c.id} index={i} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="h3" color="heading">
                    {c.title}
                  </Txt>
                  <Txt variant="small" color="textMuted">
                    {formatClassTime(c.startsAt, now())} · {c.durationMin} min
                  </Txt>
                </View>
                <Pill label={`${present}/${booked.length} here`} tone={present === booked.length && booked.length ? 'primary' : 'tint'} />
              </View>
              {booked.length === 0 ? (
                <Txt variant="small" color="textMuted">
                  Nobody has booked yet.
                </Txt>
              ) : (
                booked.map((a) => (
                  <Pressable
                    key={a.userId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: a.attended === true }}
                    accessibilityLabel={`${a.name ?? a.phone} attended`}
                    onPress={() => {
                      tapFeedback();
                      void mark(c.id, a);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}
                  >
                    <Avatar name={a.name} size={36} />
                    <Txt variant="bodyStrong" style={{ flex: 1 }}>
                      {a.name ?? a.phone}
                    </Txt>
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: a.attended ? t.primary : t.surfaceAlt }}>
                      <Icon name={a.attended ? 'check' : 'minus'} size={16} color={a.attended ? t.onPrimary : t.textMuted} />
                    </View>
                  </Pressable>
                ))
              )}
              {c.attendees.some((a) => a.status === 'waitlisted') ? (
                <Txt variant="small" color="textMuted">
                  Waitlist: {c.attendees.filter((a) => a.status === 'waitlisted').map((a) => a.name ?? a.phone).join(', ')}
                </Txt>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
