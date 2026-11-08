import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { humanize, type Exercise, type Routine, type WorkoutLog } from '@gymverse/shared';
import { Banner, Button, Card, ErrorText, IconTile, ProgressBar, Screen, Stat, Stepper, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { BadgeCelebration } from '../../components/Celebration';
import { useNav, useBackGuard } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { successFeedback, tapFeedback } from '../../utils/feedback';
import { Gate, InlineConfirm, bigNumber, clockText, emit, kg, plural, useGymApi } from './common';
import { ExercisePicker } from './parts';
import type { ScreenProps } from '../../navigation/featureRoutes';

interface SetRow {
  key: string;
  reps: number;
  weightKg: number;
  done: boolean;
}

interface Entry {
  key: string;
  exercise: Exercise;
  restSec: number;
  sets: SetRow[];
}

let seq = 0;
const k = (p: string) => `${p}-${++seq}`;

function entriesFrom(r: Routine): Entry[] {
  return r.exercises.map((e) => ({
    key: k('e'),
    exercise: e.exercise,
    restSec: e.restSec,
    sets: Array.from({ length: e.sets }, () => ({ key: k('s'), reps: e.reps, weightKg: e.weightKg ?? 0, done: false })),
  }));
}

function newEntry(ex: Exercise): Entry {
  return { key: k('e'), exercise: ex, restSec: 60, sets: Array.from({ length: 3 }, () => ({ key: k('s'), reps: 10, weightKg: 0, done: false })) };
}

function firstOpenSet(entries: Entry[]): string | null {
  for (const e of entries) for (const s of e.sets) if (!s.done) return s.key;
  return null;
}

export type Clock = () => number;

/**
 * Live workout: elapsed timer, set rows prefilled from the routine, a big Done tick per set,
 * a rest countdown after each set, then a summary. `clock` is injectable for tests.
 */
export function WorkoutSessionScreen({ params, clock = Date.now }: ScreenProps & { clock?: Clock }) {
  const routineId = params.routineId ? String(params.routineId) : null;
  const { api, gymId } = useGymApi();
  const nav = useNav();
  const t = useTheme();

  const startedAt = useRef(clock());
  const [, setTick] = useState(0);
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(!!routineId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkoutLog | null>(null);
  const [badges, setBadges] = useState<string[]>([]);

  async function load() {
    if (!routineId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api.routine(gymId, routineId);
      const list = entriesFrom(r);
      setRoutine(r);
      setEntries(list);
      setFocus(firstOpenSet(list));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [routineId, gymId]); // eslint-disable-line react-hooks/exhaustive-deps

  // One tick a second drives the elapsed clock and the rest countdown.
  useEffect(() => {
    if (result) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [result]);

  const now = clock();
  const restLeft = rest ? Math.ceil((rest.endsAt - now) / 1000) : 0;
  useEffect(() => {
    if (rest && restLeft <= 0) {
      setRest(null);
      successFeedback();
    }
  }, [rest, restLeft]);

  const allSets = entries.flatMap((e) => e.sets);
  const doneCount = allSets.filter((s) => s.done).length;
  const elapsedSec = (now - startedAt.current) / 1000;

  const completed = useMemo(
    () => entries.flatMap((e) => e.sets.filter((s) => s.done).map((s) => ({ exerciseId: e.exercise.id, reps: s.reps, weightKg: s.weightKg > 0 ? s.weightKg : null }))),
    [entries],
  );

  function updateSet(setKey: string, patch: Partial<SetRow>) {
    setEntries((es) => es.map((e) => ({ ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) })));
  }

  function toggleDone(entry: Entry, set: SetRow) {
    const nextDone = !set.done;
    const next = entries.map((e) => ({ ...e, sets: e.sets.map((s) => (s.key === set.key ? { ...s, done: nextDone } : s)) }));
    setEntries(next);
    setError(null);
    if (nextDone) {
      successFeedback();
      if (entry.restSec > 0) setRest({ endsAt: clock() + entry.restSec * 1000, total: entry.restSec });
      setFocus(firstOpenSet(next));
    } else {
      setFocus(set.key);
    }
  }

  function addSet(entry: Entry) {
    const last = entry.sets[entry.sets.length - 1];
    const row: SetRow = { key: k('s'), reps: last?.reps ?? 10, weightKg: last?.weightKg ?? 0, done: false };
    setEntries((es) => es.map((e) => (e.key === entry.key ? { ...e, sets: [...e.sets, row] } : e)));
    setFocus(row.key);
  }

  function leave() {
    if (doneCount > 0 && !result) setConfirmLeave(true);
    else nav.pop();
  }

  // Android hardware back asks before throwing away completed sets.
  useBackGuard(() => {
    if (doneCount > 0 && !result) {
      setConfirmLeave(true);
      return true;
    }
    return false;
  });

  async function finish() {
    if (completed.length === 0) {
      setError('Tick at least one set as done before you finish.');
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      const res = await api.logWorkout(gymId, {
        routineId,
        startedAt: new Date(startedAt.current).toISOString(),
        completedAt: new Date(clock()).toISOString(),
        sets: completed,
      });
      setRest(null);
      setResult(res.workout);
      setBadges(res.newBadges);
      emit('routines:changed');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFinishing(false);
    }
  }

  // ---------- summary ----------
  if (result) {
    return (
      <Screen title="Workout done" footer={<Button label="Done" onPress={nav.pop} testID="summary-done" />}>
        <Card variant="tint" style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }} testID="workout-summary">
          <IconTile icon="award" size={72} tone="primary" />
          <Txt variant="h1" color="heading" align="center">
            Great work!
          </Txt>
          <Txt color="textMuted" align="center">
            {result.routineName ?? routine?.name ?? 'Quick workout'} is in your history.
          </Txt>
        </Card>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat value={result.durationMin} label="minutes" icon="clock" testID="summary-duration" />
            <Stat value={result.sets.length} label="sets" icon="check-circle" testID="summary-sets" />
            <Stat value={bigNumber(result.totalVolumeKg)} label="kg lifted" icon="trending-up" testID="summary-volume" />
          </View>
        </Card>
        <BadgeCelebration badgeId={badges[0] ?? null} onClose={() => setBadges((b) => b.slice(1))} />
      </Screen>
    );
  }

  // ---------- live session ----------
  const title = routine?.name ?? (routineId ? 'Workout' : 'Quick workout');
  return (
    <Screen
      title={title}
      onBack={leave}
      footer={
        confirmLeave ? (
          <InlineConfirm
            testID="confirm-leave"
            message="Discard this workout?"
            detail={`Your ${plural(doneCount, 'completed set')} will not be saved.`}
            confirmLabel="Discard"
            cancelLabel="Keep going"
            onConfirm={nav.pop}
            onCancel={() => setConfirmLeave(false)}
          />
        ) : !loading && !loadError ? (
          <>
            <ErrorText message={error} />
            <Button label="Finish workout" icon="flag" onPress={finish} loading={finishing} testID="finish-workout" />
          </>
        ) : undefined
      }
    >
      <Gate loading={loading} error={loadError} ready={!loading && !loadError} onRetry={load}>
        {() => (
          <>
            <Card variant="tint" style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <View>
                  <Txt variant="caption" color="textMuted">
                    Time
                  </Txt>
                  <Txt variant="display" color="heading" testID="elapsed">
                    {clockText(elapsedSec)}
                  </Txt>
                </View>
                <Txt variant="bodyStrong" color="primaryText" testID="sets-done">
                  {doneCount} of {allSets.length} sets
                </Txt>
              </View>
              <ProgressBar value={allSets.length ? doneCount / allSets.length : 0} label="Sets done" />
            </Card>

            {rest ? (
              <View accessibilityLiveRegion="polite">
                <Banner testID="rest-timer" icon="clock" text={`Rest ${clockText(restLeft)}`} actionLabel="Skip rest" onAction={() => setRest(null)} />
              </View>
            ) : null}

            {entries.length === 0 ? (
              <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
                <IconTile icon="plus" size={56} />
                <Txt variant="h3" color="heading" align="center">
                  Add your first exercise
                </Txt>
                <Txt color="textMuted" align="center">
                  Pick what you are doing today, then tick each set as you finish it.
                </Txt>
              </Card>
            ) : null}

            {entries.map((e) => (
              <Card key={e.key} testID={`entry-${e.exercise.id}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3" color="heading">
                      {e.exercise.name}
                    </Txt>
                    <Txt variant="small" color="textMuted">
                      {humanize(e.exercise.muscleGroup)} · Rest {e.restSec} s
                    </Txt>
                  </View>
                </View>
                {e.sets.map((s, i) => {
                  const open = focus === s.key && !s.done;
                  return (
                    <View key={s.key} style={{ gap: 8, paddingVertical: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Set ${i + 1} of ${e.exercise.name}: ${s.reps} reps, ${kg(s.weightKg > 0 ? s.weightKg : null)}. ${s.done ? 'Done' : 'Edit'}`}
                          onPress={() => {
                            tapFeedback();
                            setFocus(s.key);
                          }}
                          style={{ flex: 1, minHeight: 56, justifyContent: 'center', borderRadius: t.radius.md, paddingHorizontal: 12, backgroundColor: open ? t.tint : t.surfaceAlt }}
                        >
                          <Txt variant="caption" color="textMuted">
                            Set {i + 1}
                          </Txt>
                          <Txt variant="bodyStrong" color={s.done ? 'textMuted' : 'text'}>
                            {s.reps} reps × {kg(s.weightKg > 0 ? s.weightKg : null)}
                          </Txt>
                        </Pressable>
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: s.done }}
                          accessibilityLabel={`Done, set ${i + 1} of ${e.exercise.name}`}
                          testID={`done-${e.exercise.id}-${i + 1}`}
                          onPress={() => toggleDone(e, s)}
                          style={({ pressed }) => ({
                            width: 56,
                            height: 56,
                            borderRadius: 28,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: s.done ? t.primary : t.surface,
                            borderWidth: 2,
                            borderColor: s.done ? t.primary : t.border,
                            transform: [{ scale: pressed ? 0.92 : 1 }],
                          })}
                        >
                          <Icon name="check" size={26} color={s.done ? t.onPrimary : t.textMuted} />
                        </Pressable>
                      </View>
                      {open ? (
                        <View style={{ gap: 8, paddingLeft: 4 }}>
                          <Stepper label="Reps" value={s.reps} min={0} max={200} onChange={(v) => updateSet(s.key, { reps: v })} />
                          <Stepper label="Weight" unit="kg" value={s.weightKg} step={2.5} min={0} max={500} onChange={(v) => updateSet(s.key, { weightKg: v })} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                <Button label="Add set" icon="plus" variant="ghost" size="md" full={false} onPress={() => addSet(e)} />
              </Card>
            ))}

            <Button label="Add exercise" icon="plus" variant="soft" onPress={() => setPicker(true)} testID="add-exercise" />
            <ExercisePicker
              visible={picker}
              onClose={() => setPicker(false)}
              onAdd={(list) => {
                const next = [...entries, ...list.map(newEntry)];
                setEntries(next);
                if (!focus || !next.some((x) => x.sets.some((s) => s.key === focus && !s.done))) setFocus(firstOpenSet(next));
              }}
            />
          </>
        )}
      </Gate>
    </Screen>
  );
}
