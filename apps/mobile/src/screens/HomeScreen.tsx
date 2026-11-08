import React, { useEffect, useState } from 'react';
import { Image, Share, View } from 'react-native';
import type { AppTheme, Crowd, MemberSummary } from '@gymverse/shared';
import { useToast } from '../components/Toast';
import { flushCheckIns, queueCheckIn } from '../utils/offlineQueue';
import {
  Banner,
  BrandBlob,
  Card,
  DateBadge,
  ErrorText,
  IconButton,
  IconTile,
  Loading,
  Pill,
  ProgressBar,
  QuickAction,
  Screen,
  SearchPill,
  SectionHeader,
  Stat,
  Txt,
} from '../components/ui';
import { CheckInButton } from '../components/CheckInButton';
import { BadgeCelebration } from '../components/Celebration';
import { Icon } from '../components/Icon';
import { useSession } from '../state/session';
import { useFeature, useGym, useIsStaff } from '../state/hooks';
import { useNav } from '../navigation/Nav';
import { useTheme } from '../theme/ThemeContext';
import { useT } from '../i18n';
import { firstName, formatClassTime } from '../utils/format';
import { successFeedback } from '../utils/feedback';
import { useLoad } from '../utils/useLoad';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const CROWD: Record<Crowd['level'], { label: string; color: (t: AppTheme) => string }> = {
  quiet: { label: 'Quiet', color: (t) => t.success },
  moderate: { label: 'Moderately busy', color: (t) => t.warning },
  busy: { label: 'Busy', color: (t) => t.danger },
};

/** Home: greeting, weekly goal, one main action (check in), then what's next (PRD §6.1, revamp). */
export function HomeScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { api, me, storage } = useSession();
  const gym = useGym();
  const isStaff = useIsStaff();
  const toast = useToast();
  const nav = useNav();
  const t = useTheme();
  const tr = useT();
  const has = {
    checkin: useFeature('checkin'),
    workouts: useFeature('workouts'),
    nutrition: useFeature('nutrition'),
    resources: useFeature('resources'),
    progress: useFeature('progress'),
    support: useFeature('support'),
    community: useFeature('community'),
    payments: useFeature('payments'),
  };
  const { data, error, loading, reload, setData } = useLoad(() => api.summary(gym.id), gym.id);
  const [checking, setChecking] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [badgeQueue, setBadgeQueue] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  async function checkIn() {
    setChecking(true);
    setActionError(null);
    try {
      const res = await api.checkIn(gym.id);
      setData((prev: MemberSummary | null) => {
        if (!prev) return prev;
        const todayIdx = (now().getDay() + 6) % 7;
        const days = prev.weekly.days.map((v, i) => (i === todayIdx ? 1 : v));
        const visits = res.alreadyCheckedIn ? prev.weekly.visits : prev.weekly.visits + 1;
        return {
          ...prev,
          checkedInToday: true,
          streak: res.streak,
          totalCheckIns: res.totalCheckIns,
          badges: [...prev.badges, ...res.newBadges.filter((b) => !prev.badges.includes(b))],
          weekly: { ...prev.weekly, visits, days, percent: Math.min(100, Math.round((visits / prev.weekly.goal) * 100)) },
        };
      });
      if (!res.alreadyCheckedIn) {
        successFeedback();
        setCelebrate((n) => n + 1);
        setBadgeQueue(res.newBadges);
      }
    } catch (err) {
      if ((err as { status?: number }).status === 0) {
        // Offline: keep the check-in with its real time and sync it later.
        await queueCheckIn(storage, { gymId: gym.id, occurredAt: now().toISOString() });
        setData((prev: MemberSummary | null) => (prev ? { ...prev, checkedInToday: true } : prev));
        toast.show({ title: 'Checked in offline', body: "We'll sync it when you're back online.", icon: 'wifi-off' });
      } else {
        setActionError((err as Error).message);
      }
    } finally {
      setChecking(false);
    }
  }

  // Send any check-ins saved while offline, then refresh.
  useEffect(() => {
    void flushCheckIns(storage, api, now()).then((sent) => {
      if (sent > 0) {
        toast.show({ title: 'Offline check-in synced' });
        void reload();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gym.id]);

  async function invite() {
    try {
      const r = await api.referral(gym.id);
      await Share.share({ message: `${r.message} ${r.link}` });
    } catch (err) {
      toast.show({ title: "Couldn't open sharing", body: (err as Error).message, icon: 'alert-circle' });
    }
  }

  if (!data) return error ? <ErrorText message={error} /> : <Loading />;
  const m = data.membership;
  const hour = now().getHours();
  const greet = hour < 12 ? tr('home.morning') : hour < 17 ? tr('home.afternoon') : tr('home.evening');
  const quick = [
    has.nutrition && { icon: 'coffee' as const, label: 'Nutrition', go: () => nav.push('Nutrition') },
    has.resources && { icon: 'book-open' as const, label: 'Learn', go: () => nav.push('Resources') },
    has.progress && { icon: 'trending-up' as const, label: 'Progress', go: () => nav.push('Progress') },
    has.support && { icon: 'life-buoy' as const, label: 'Help', go: () => nav.push('Support') },
  ].filter(Boolean) as Array<{ icon: 'coffee'; label: string; go: () => void }>;
  const w = data.weekly;
  const routine = has.workouts ? data.recommendedRoutine : null;
  const challenge = has.community ? data.activeChallenge : null;

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="home" decor={<BrandBlob />} refreshing={loading} onRefresh={reload}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {gym.branding.logoUrl ? (
            <Image source={{ uri: gym.branding.logoUrl }} accessibilityLabel={`${gym.name} logo`} style={{ width: 48, height: 48, borderRadius: 14 }} />
          ) : (
            <View accessibilityLabel={`${gym.name} logo`} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="h2" color="onPrimary">
                {gym.name.slice(0, 1).toUpperCase()}
              </Txt>
            </View>
          )}
          <IconButton icon="bell" label="Notifications" badge={data.unreadNotifications} onPress={() => nav.push('Notifications')} testID="bell" />
        </View>

        <View style={{ gap: 2, marginTop: 4 }}>
          <Txt variant="h3" color="text" style={{ fontSize: 19 }}>
            {greet}
          </Txt>
          <Txt variant="display" color="heading" accessibilityRole="header">
            {me?.user.name ? `${firstName(me.user.name)}!` : 'Hello!'}
          </Txt>
          <Txt variant="body" color="textMuted">
            {gym.name}
            {gym.branding.tagline ? ` · ${gym.branding.tagline}` : ''}
          </Txt>
          {data.crowd ? (
            <View testID="crowd" accessibilityLabel={`The gym is ${CROWD[data.crowd.level].label.toLowerCase()} right now`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: CROWD[data.crowd.level].color(t) }} />
              <Txt variant="smallStrong" color="textMuted">
                {CROWD[data.crowd.level].label} right now
              </Txt>
            </View>
          ) : null}
        </View>

        <SearchPill placeholder={tr('home.search')} onPress={() => nav.push('Search')} testID="search-pill" />

        {has.payments && m.state === 'expiring' ? (
          <Banner testID="renew-banner" icon="clock" text={`Membership ends in ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'}`} actionLabel="Renew" onAction={nav.openRenew} />
        ) : has.payments && (m.state === 'expired' || m.state === 'none') ? (
          <Banner
            testID="renew-banner"
            tone="danger"
            icon="alert-circle"
            text={m.state === 'expired' ? 'Your membership has ended' : 'No active membership'}
            actionLabel={m.state === 'expired' ? 'Renew' : 'Buy plan'}
            onAction={nav.openRenew}
          />
        ) : null}

        <Card index={0} variant="tint" testID="weekly-goal" style={{ gap: 12, backgroundColor: t.tint }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconTile icon="bar-chart-2" size={34} tone="primary" />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {tr('home.weeklyGoal')} · {w.visits >= w.goal ? `goal reached, ${w.visits} visits` : `${w.visits} of ${w.goal} visits`}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Txt variant="display" color="heading" testID="weekly-percent">
                {w.percent}%
              </Txt>
              <Txt variant="smallStrong" color="primaryText">
                {w.deltaVsLastWeek > 0 ? `↑ ${w.deltaVsLastWeek} more than last week` : w.deltaVsLastWeek < 0 ? `${-w.deltaVsLastWeek} fewer than last week` : 'Same as last week'}
              </Txt>
            </View>
            <View accessibilityLabel={`Visited on ${w.days.filter(Boolean).length} days this week`} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              {w.days.map((v, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 14, height: v ? 30 : 14, borderRadius: 7, backgroundColor: v ? t.primary : t.surface }} />
                  <Txt variant="small" color="textMuted" style={{ fontSize: 10 }}>
                    {DAY_LETTERS[i]}
                  </Txt>
                </View>
              ))}
            </View>
          </View>
          <ProgressBar value={w.percent / 100} label="Weekly goal progress" />
        </Card>

        {has.checkin ? (
          <CheckInButton checkedIn={data.checkedInToday} loading={checking} onPress={checkIn} celebrate={celebrate} label={tr('home.checkin')} doneLabel={tr('home.checkedIn')} />
        ) : null}
        {has.checkin && !data.checkedInToday ? (
          <Txt variant="small" color="textMuted" align="center">
            At the gym? You can also scan the QR on the door with your phone camera.
          </Txt>
        ) : null}
        <ErrorText message={actionError} />

        <Card index={1} testID="streak-card" style={{ flexDirection: 'row' }}>
          <Stat icon="zap" value={data.streak.current} label="day streak" testID="streak" />
          <Stat icon="award" value={data.badges.length} label="badges" />
          <Stat icon="check-circle" value={data.totalCheckIns} label="visits" />
        </Card>

        {isStaff ? (
          <Card testID="coach-card" onPress={() => nav.push('Coach')} accessibilityLabel="Coach tools: today's classes and attendance" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconTile icon="clipboard" size={44} tone="primary" />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Coach tools</Txt>
              <Txt variant="small" color="textMuted">
                Today's classes and attendance
              </Txt>
            </View>
            <Icon name="chevron-right" size={20} color={t.textMuted} />
          </Card>
        ) : null}

        {quick.length ? (
          <>
            <SectionHeader title={tr('home.quick')} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {quick.map((q) => (
                <QuickAction key={q.label} icon={q.icon} label={q.label} onPress={q.go} />
              ))}
            </View>
          </>
        ) : null}

        {routine ? (
          <Card index={2} testID="recommended-routine" onPress={() => nav.push('RoutineDetail', { id: routine.id })} accessibilityLabel={`Workout: ${routine.name}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconTile icon="activity" size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <Pill label={routine.assignment ? `From ${routine.assignment.by.name ?? 'your coach'}` : "Today's workout"} />
                <Txt variant="h3" color="heading">
                  {routine.name}
                </Txt>
                <Txt variant="small" color="textMuted">
                  ~{routine.durationMin} min · {routine.exercises.length} exercises
                </Txt>
              </View>
              <Icon name="chevron-right" size={20} color={t.textMuted} />
            </View>
            {routine.assignment?.note ? (
              <Txt variant="small" color="textMuted">
                “{routine.assignment.note}”
              </Txt>
            ) : null}
          </Card>
        ) : null}

        {challenge ? (
          <Card index={3} testID="challenge-card" onPress={() => nav.push('ChallengeDetail', { id: challenge.id })} accessibilityLabel={`Challenge: ${challenge.title}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconTile icon="flag" size={42} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{challenge.title}</Txt>
                <Txt variant="small" color="textMuted">
                  {challenge.joined
                    ? `${challenge.myProgress} of ${challenge.target}${challenge.myRank ? ` · rank #${challenge.myRank}` : ''}`
                    : `${challenge.participantCount} taking part · tap to join`}
                </Txt>
              </View>
            </View>
            {challenge.joined ? <ProgressBar value={challenge.myProgress / challenge.target} label="Challenge progress" /> : null}
          </Card>
        ) : null}

        {data.nextClass ? (
          <>
            <SectionHeader title={tr('home.upcoming')} actionLabel={tr('common.seeAll')} onAction={() => nav.setTab('classes')} />
            <Card index={4} testID="next-class" onPress={() => nav.setTab('classes')} accessibilityLabel={`Next class: ${data.nextClass.title}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <DateBadge iso={data.nextClass.startsAt} />
              <View style={{ flex: 1 }}>
                <Txt variant="h3" color="heading">
                  {data.nextClass.title}
                </Txt>
                <Txt variant="small" color="textMuted">
                  {formatClassTime(data.nextClass.startsAt, now())}
                  {data.nextClass.trainerName ? ` · ${data.nextClass.trainerName}` : ''}
                </Txt>
                {data.nextClass.myStatus === 'waitlisted' ? (
                  <Txt variant="smallStrong" color="warning">
                    #{data.nextClass.myWaitlistPosition} on the waitlist
                  </Txt>
                ) : null}
              </View>
              <Icon name="chevron-right" size={20} color={t.textMuted} />
            </Card>
          </>
        ) : null}

        {data.announcement ? (
          <Card index={5} testID="announcement" onPress={() => nav.push('Announcements')} accessibilityLabel={`From your gym: ${data.announcement.title}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name={data.announcement.pinned ? 'bookmark' : 'volume-2'} size={16} color={t.primaryText} />
              <Txt variant="caption" color="textMuted">
                From your gym
              </Txt>
            </View>
            <Txt variant="h3" color="heading">
              {data.announcement.title}
            </Txt>
            <Txt variant="body">{data.announcement.body}</Txt>
          </Card>
        ) : null}

        <Card index={6} variant="tint" testID="invite" onPress={() => void invite()} accessibilityLabel="Invite a friend" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconTile icon="gift" size={44} tone="primary" />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">Invite a friend</Txt>
            <Txt variant="small" color="textMuted">
              Share your gym's link. Training is better together.
            </Txt>
          </View>
          <Icon name="share-2" size={20} color={t.primaryText} />
        </Card>
      </Screen>
      <BadgeCelebration badgeId={badgeQueue[0] ?? null} onClose={() => setBadgeQueue((q) => q.slice(1))} />
    </View>
  );
}
