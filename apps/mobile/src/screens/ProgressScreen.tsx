import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BADGES } from '@gymverse/shared';
import { BarChart, LineChart } from '../components/Charts';
import { Button, Card, ErrorText, Field, IconTile, Loading, Screen, Segmented, Sheet, Stat, Txt } from '../components/ui';
import { useToast } from '../components/Toast';
import { useSession } from '../state/session';
import { useFeature, useGym } from '../state/hooks';
import { useNav } from '../navigation/Nav';
import { useTheme } from '../theme/ThemeContext';
import { TYPE } from '../theme/type';
import { lastDays, localDayKey } from '../utils/format';
import { useLoad } from '../utils/useLoad';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** Progress tracking (FitBody gap): workout log charts, body weight, personal bests, visits, badges. */
export function ProgressScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { api, setMe, me } = useSession();
  const gym = useGym();
  const nav = useNav();
  const t = useTheme();
  const toast = useToast();
  const workoutsOn = useFeature('workouts');
  const summary = useLoad(() => api.summary(gym.id), gym.id);
  const stats = useLoad(() => (workoutsOn ? api.progress(gym.id) : Promise.resolve(null)), gym.id);
  const measures = useLoad(() => api.measurements(), 'me');
  const [chart, setChart] = useState<'workouts' | 'visits'>('workouts');
  const [sheet, setSheet] = useState(false);
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveMeasurement() {
    const w = weight.trim() ? Number(weight) : null;
    const wc = waist.trim() ? Number(waist) : null;
    if (w === null && wc === null) return setFormError('Enter your weight or waist.');
    if ((w !== null && (isNaN(w) || w < 20 || w > 350)) || (wc !== null && (isNaN(wc) || wc < 30 || wc > 250))) return setFormError('Check the numbers and try again.');
    setSaving(true);
    setFormError(null);
    try {
      await api.addMeasurement({ measuredOn: localDayKey(now()), weightKg: w, waistCm: wc });
      setSheet(false);
      setWeight('');
      setWaist('');
      toast.show({ title: 'Measurement saved', body: w ? `${w} kg` : `${wc} cm waist` });
      void measures.reload();
      void stats.reload();
      void api.me().then(setMe).catch(() => undefined);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const s = summary.data;
  if (!s) return summary.error ? <ErrorText message={summary.error} /> : <Loading />;
  const p = stats.data;
  const visited = new Set(s.recentDays);
  const days = lastDays(localDayKey(now()), 28);
  const earned = new Set(s.badges);
  const weightPoints = (measures.data?.measurements ?? []).filter((m) => m.weightKg != null).map((m) => ({ label: shortDay(m.measuredOn), value: m.weightKg as number }));
  const latest = weightPoints[weightPoints.length - 1];
  const first = weightPoints[0];

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Progress" onBack={nav.stack.length ? nav.pop : undefined} testID="progress">
        <Card style={{ flexDirection: 'row' }}>
          <Stat icon="zap" value={s.streak.current} label="day streak" />
          <Stat icon="star" value={s.streak.longest} label="best streak" />
          <Stat icon={workoutsOn ? 'activity' : 'check-circle'} value={workoutsOn && p ? p.totalWorkouts : s.totalCheckIns} label={workoutsOn ? 'workouts' : 'visits'} />
        </Card>

        {p ? (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt variant="h3" color="heading">
                Last 8 weeks
              </Txt>
            </View>
            <Segmented<'workouts' | 'visits'>
              value={chart}
              onChange={setChart}
              options={[
                { id: 'workouts', label: 'Workouts' },
                { id: 'visits', label: 'Gym visits' },
              ]}
            />
            <BarChart
              testID="weekly-chart"
              label={chart === 'workouts' ? 'Workouts per week' : 'Gym visits per week'}
              data={p.weekly.map((w) => ({ label: shortDay(w.weekStart).split(' ')[0], value: chart === 'workouts' ? w.workouts : w.checkIns }))}
            />
            <Txt variant="small" color="textMuted">
              Weeks start on Monday. Total lifted in 8 weeks: {Math.round(p.weekly.reduce((a, w) => a + w.volumeKg, 0)).toLocaleString('en-IN')} kg
            </Txt>
          </Card>
        ) : null}

        <Card style={{ gap: 12 }} testID="weight-card">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Txt variant="h3" color="heading">
                Body weight
              </Txt>
              {latest ? (
                <Text style={[TYPE.number, { color: t.heading }]}>
                  {latest.value}
                  <Text style={[TYPE.h3, { color: t.textMuted }]}> kg</Text>
                </Text>
              ) : (
                <Txt variant="small" color="textMuted">
                  {me?.profile.weightKg ? `${me.profile.weightKg} kg from your profile` : 'No measurements yet'}
                </Txt>
              )}
              {latest && first && latest !== first ? (
                <Txt variant="smallStrong" color="primaryText">
                  {latest.value - first.value > 0 ? '+' : ''}
                  {(latest.value - first.value).toFixed(1)} kg since {first.label}
                </Txt>
              ) : null}
            </View>
            <Button label="Add" icon="plus" size="sm" full={false} onPress={() => setSheet(true)} />
          </View>
          {weightPoints.length > 1 ? <LineChart testID="weight-chart" label="Body weight" unit=" kg" points={weightPoints} /> : null}
        </Card>

        {p && p.personalBests.length ? (
          <Card style={{ gap: 10 }}>
            <Txt variant="h3" color="heading">
              Personal bests
            </Txt>
            {p.personalBests.map((b) => (
              <View key={b.exerciseId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile icon="award" size={40} />
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{b.exerciseName}</Txt>
                  <Txt variant="small" color="textMuted">
                    {shortDay(b.on)}
                  </Txt>
                </View>
                <Txt variant="h3" color="heading">
                  {b.weightKg} kg × {b.reps}
                </Txt>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Txt variant="h3" color="heading">
            Last 4 weeks
          </Txt>
          <View accessibilityLabel={`${s.recentDays.length} visits in the last 4 weeks`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {days.map((d) => (
              <View
                key={d}
                testID={visited.has(d) ? 'day-visited' : 'day-empty'}
                style={{ width: '12.4%', aspectRatio: 1, borderRadius: 10, backgroundColor: visited.has(d) ? t.primary : t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={[TYPE.smallStrong, { fontSize: 11, color: visited.has(d) ? t.onPrimary : t.textMuted }]}>{Number(d.slice(8))}</Text>
              </View>
            ))}
          </View>
          <Txt variant="small" color="textMuted">
            {s.recentDays.length} visits in the last 4 weeks
          </Txt>
        </Card>

        <Txt variant="h3" color="heading">
          Badges
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {BADGES.map((b) => {
            const has = earned.has(b.id);
            return (
              <View
                key={b.id}
                testID={has ? `badge-earned-${b.id}` : `badge-locked-${b.id}`}
                accessibilityLabel={`${b.title}: ${b.description}${has ? ', earned' : ', locked'}`}
                style={{ flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 4, padding: 12, borderRadius: t.radius.lg, backgroundColor: has ? t.tint : t.surface, borderWidth: 1, borderColor: t.border, opacity: has ? 1 : 0.55 }}
              >
                <Text style={{ fontSize: 32 }}>{has ? b.emoji : '🔒'}</Text>
                <Txt variant="smallStrong" align="center">
                  {b.title}
                </Txt>
                <Txt variant="small" color="textMuted" align="center" style={{ fontSize: 11 }}>
                  {b.description}
                </Txt>
              </View>
            );
          })}
        </View>
      </Screen>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Add a measurement" testID="measurement-sheet">
        <Field label="Weight (kg)" keyboardType="decimal-pad" placeholder="e.g. 80.5" value={weight} onChangeText={setWeight} />
        <Field label="Waist (cm, optional)" keyboardType="decimal-pad" placeholder="e.g. 88" value={waist} onChangeText={setWaist} />
        <ErrorText message={formError} />
        <Button label="Save measurement" onPress={saveMeasurement} loading={saving} />
      </Sheet>
    </View>
  );
}
