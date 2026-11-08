import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ClassSession } from '@gymverse/shared';
import { Avatar, BrandBlob, Button, Card, EmptyState, ErrorText, Loading, Pill, Screen, Txt } from '../components/ui';
import { BadgeCelebration } from '../components/Celebration';
import { useToast } from '../components/Toast';
import { useSession } from '../state/session';
import { useGym } from '../state/hooks';
import { useTheme } from '../theme/ThemeContext';
import { TYPE } from '../theme/type';
import { formatClassTime, localDayKey } from '../utils/format';
import { successFeedback, tapFeedback } from '../utils/feedback';
import { useLoad } from '../utils/useLoad';

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Book a class in 3 taps: Classes tab → class → Book (PRD §7). */
export function ClassesScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { api } = useSession();
  const gym = useGym();
  const t = useTheme();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(() => api.classes(gym.id), gym.id);
  const [day, setDay] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [badge, setBadge] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = now();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { key: localDayKey(d), wd: WD[d.getDay()], date: d.getDate() };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replace = (s: ClassSession) => setData((prev) => (prev ? { classes: prev.classes.map((c) => (c.id === s.id ? s : c)) } : prev));

  async function toggle(c: ClassSession) {
    setBusyId(c.id);
    setActionError(null);
    try {
      if (c.myStatus) {
        replace((await api.cancelBooking(gym.id, c.id)).session);
        toast.show({ title: c.myStatus === 'booked' ? 'Booking cancelled' : 'Left the waitlist', body: c.title, icon: 'x' });
      } else {
        const res = await api.book(gym.id, c.id);
        replace(res.session);
        successFeedback();
        toast.show(
          res.session.myStatus === 'booked'
            ? { title: `Booked ${c.title}`, body: formatClassTime(c.startsAt, now()) }
            : { title: `You're #${res.session.myWaitlistPosition} on the waitlist`, body: "We'll move you in if a spot opens", icon: 'clock' },
        );
        if (res.newBadges[0]) setBadge(res.newBadges[0]);
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return error ? <ErrorText message={error} /> : <Loading />;
  const shown = day ? data.classes.filter((c) => localDayKey(new Date(c.startsAt)) === day) : data.classes;

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="classes" title="Classes" decor={<BrandBlob />} refreshing={loading} onRefresh={reload}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <DayChip label="ALL" big="7d" selected={day === null} onPress={() => setDay(null)} a11y="All days" />
          {days.map((d) => (
            <DayChip key={d.key} label={d.wd} big={String(d.date)} selected={day === d.key} onPress={() => setDay(d.key)} a11y={`${d.wd} ${d.date}`} />
          ))}
        </ScrollView>
        <ErrorText message={actionError} />
        {shown.length === 0 ? (
          <EmptyState icon="calendar" title={day ? 'No classes this day' : 'No classes yet'} body={day ? 'Try another day.' : 'Check back soon, your gym adds classes every week.'} />
        ) : null}
        {shown.map((c, i) => {
          const spotsLeft = Math.max(0, c.capacity - c.bookedCount);
          const full = spotsLeft === 0;
          const label = c.myStatus === 'booked' ? 'Cancel booking' : c.myStatus === 'waitlisted' ? 'Leave waitlist' : full ? 'Join waitlist' : 'Book';
          return (
            <Card key={c.id} index={i} testID={`class-${c.id}`} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="h3" color="heading">
                    {c.title}
                  </Txt>
                  <Txt variant="small" color="textMuted">
                    {formatClassTime(c.startsAt, now())} · {c.durationMin} min
                  </Txt>
                </View>
                {c.myStatus === 'booked' ? (
                  <Pill label="✓ Booked" tone="primary" />
                ) : c.myStatus === 'waitlisted' ? (
                  <Pill label={`Waitlist #${c.myWaitlistPosition}`} tone="warning" />
                ) : full ? (
                  <Pill label={c.waitlistCount ? `Full · ${c.waitlistCount} waiting` : 'Full'} tone="muted" />
                ) : (
                  <Pill label={`${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`} />
                )}
              </View>
              {c.trainerName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Avatar name={c.trainerName} size={28} />
                  <Txt variant="small" color="textMuted">
                    {c.trainerName}
                  </Txt>
                </View>
              ) : null}
              <Button
                testID={`class-action-${c.id}`}
                label={label}
                variant={c.myStatus ? 'outline' : 'primary'}
                size="md"
                arrow={!c.myStatus}
                loading={busyId === c.id}
                onPress={() => {
                  tapFeedback();
                  void toggle(c);
                }}
              />
            </Card>
          );
        })}
      </Screen>
      <BadgeCelebration badgeId={badge} onClose={() => setBadge(null)} />
    </View>
  );

  function DayChip({ label, big, selected, onPress, a11y }: { label: string; big: string; selected: boolean; onPress: () => void; a11y: string }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityState={{ selected }}
        onPress={onPress}
        style={{
          width: 58,
          paddingVertical: 10,
          borderRadius: t.radius.md,
          alignItems: 'center',
          backgroundColor: selected ? t.primary : t.surface,
          borderWidth: 1,
          borderColor: selected ? t.primary : t.border,
        }}
      >
        <Text style={[TYPE.caption, { color: selected ? t.onPrimary : t.textMuted, letterSpacing: 0.5 }]}>{label}</Text>
        <Text style={[TYPE.h3, { color: selected ? t.onPrimary : t.text }]}>{big}</Text>
      </Pressable>
    );
  }
}
