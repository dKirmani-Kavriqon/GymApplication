import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { MUSCLE_GROUPS, humanize, type Exercise, type Routine, type WorkoutLog } from '@gymverse/shared';
import { Button, Card, Chip, Divider, EmptyState, ErrorText, IconTile, Pill, Sheet, Spinner, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { TYPE } from '../../theme/type';
import { formatDate } from '../../utils/format';
import { useLoad } from '../../utils/useLoad';
import { tapFeedback } from '../../utils/feedback';
import { FavouriteButton, Gate, bigNumber, kg, plural, useBus, useGymApi } from './common';

// ---------- routine card ----------

export function RoutineCard({ routine, onPress, showCoach, index }: { routine: Routine; onPress: () => void; showCoach?: boolean; index?: number }) {
  const t = useTheme();
  return (
    <Card testID={`routine-${routine.id}`} index={index}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${routine.name}, ${humanize(routine.level)}, about ${routine.durationMin} minutes, ${plural(routine.exercises.length, 'exercise')}`}
          onPress={() => {
            tapFeedback();
            onPress();
          }}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 48, opacity: pressed ? 0.7 : 1 })}
        >
          <IconTile icon="activity" size={48} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="h3" color="heading" numberOfLines={2}>
              {routine.name}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Pill label={humanize(routine.level)} />
              <Txt variant="small" color="textMuted">
                ~{routine.durationMin} min · {plural(routine.exercises.length, 'exercise')}
              </Txt>
            </View>
          </View>
        </Pressable>
        <FavouriteButton kind="routine" id={routine.id} value={routine.favourite} name={routine.name} />
      </View>
      {showCoach && routine.assignment ? (
        <View style={{ backgroundColor: t.tint, borderRadius: t.radius.md, padding: 12, gap: 2 }} testID={`coach-note-${routine.id}`}>
          <Txt variant="smallStrong" color="primaryText">
            From {routine.assignment.by.name ?? 'your coach'}
          </Txt>
          {routine.assignment.note ? <Txt variant="small">“{routine.assignment.note}”</Txt> : null}
        </View>
      ) : null}
    </Card>
  );
}

// ---------- workout history ----------

function groupSets(w: WorkoutLog) {
  const groups: Array<{ name: string; sets: WorkoutLog['sets'] }> = [];
  for (const s of w.sets) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.exerciseName) last.sets.push(s);
    else groups.push({ name: s.exerciseName, sets: [s] });
  }
  return groups;
}

export function WorkoutCard({ workout, index }: { workout: WorkoutLog; index?: number }) {
  const [open, setOpen] = useState(false);
  const t = useTheme();
  const title = workout.routineName ?? 'Quick workout';
  return (
    <Card testID={`workout-${workout.id}`} index={index}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${formatDate(workout.startedAt)}. ${open ? 'Hide' : 'Show'} sets`}
        onPress={() => {
          tapFeedback();
          setOpen((o) => !o);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}
      >
        <IconTile icon="check-circle" size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="caption" color="textMuted">
            {formatDate(workout.startedAt)}
          </Txt>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {title}
          </Txt>
          <Txt variant="small" color="textMuted">
            {workout.durationMin} min · {bigNumber(workout.totalVolumeKg)} kg · {plural(workout.sets.length, 'set')}
          </Txt>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={t.textMuted} />
      </Pressable>
      {open ? (
        <View style={{ gap: 10, paddingTop: 4 }}>
          <Divider />
          {groupSets(workout).map((g, i) => (
            <View key={`${g.name}-${i}`} style={{ gap: 2 }}>
              <Txt variant="smallStrong">{g.name}</Txt>
              {g.sets.map((s) => (
                <Txt key={s.setNumber} variant="small" color="textMuted">
                  Set {s.setNumber}: {s.reps} reps × {kg(s.weightKg)}
                </Txt>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function WorkoutHistoryList({ onStart }: { onStart?: () => void }) {
  const { api, gymId } = useGymApi();
  const { data, error, loading, reload } = useLoad(() => api.workouts(gymId, 30), gymId);
  useBus('routines:changed', () => void reload());
  return (
    <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
      {() =>
        data!.workouts.length === 0 ? (
          <EmptyState icon="clipboard" title="No workouts yet" body="Finish a workout and it will show up here." actionLabel={onStart ? 'Start a workout' : undefined} onAction={onStart} />
        ) : (
          <View style={{ gap: 12 }}>
            {data!.workouts.map((w, i) => (
              <WorkoutCard key={w.id} workout={w} index={i} />
            ))}
          </View>
        )
      }
    </Gate>
  );
}

// ---------- exercise picker ----------

/** Bottom sheet to pick one or more exercises: search + muscle chips (api.exercises). */
export function ExercisePicker({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (exercises: Exercise[]) => void }) {
  const { api, gymId } = useGymApi();
  const t = useTheme();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [picked, setPicked] = useState<Exercise[]>([]);
  const { data, error, loading } = useLoad(
    () => (visible ? api.exercises(gymId, { q: q.trim() || undefined, muscle: muscle ?? undefined }) : Promise.resolve(null)),
    `${visible}|${q.trim()}|${muscle}`,
  );

  function close() {
    setPicked([]);
    onClose();
  }

  function toggle(ex: Exercise) {
    setPicked((p) => (p.some((x) => x.id === ex.id) ? p.filter((x) => x.id !== ex.id) : [...p, ex]));
  }

  return (
    <Sheet visible={visible} onClose={close} title="Add exercises" testID="exercise-picker">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, borderRadius: 999, backgroundColor: t.surfaceAlt, paddingHorizontal: 18 }}>
        <Icon name="search" size={18} color={t.textMuted} />
        <TextInput
          accessibilityLabel="Search exercises"
          placeholder="Search exercises"
          placeholderTextColor={t.textMuted}
          value={q}
          onChangeText={setQ}
          style={[TYPE.body, { flex: 1, color: t.text, height: 50 }]}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="All" selected={muscle === null} onPress={() => setMuscle(null)} />
        {MUSCLE_GROUPS.map((m) => (
          <Chip key={m} label={humanize(m)} selected={muscle === m} onPress={() => setMuscle(m)} />
        ))}
      </View>
      {error ? <ErrorText message={error} /> : null}
      {loading && !data ? <Spinner /> : null}
      {data && data.exercises.length === 0 ? (
        <Txt color="textMuted" align="center">
          No exercises match. Try another word or muscle.
        </Txt>
      ) : null}
      {data?.exercises.map((ex) => {
        const on = picked.some((p) => p.id === ex.id);
        return (
          <Pressable
            key={ex.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${ex.name}, ${humanize(ex.muscleGroup)}, ${humanize(ex.equipment)}`}
            onPress={() => {
              tapFeedback();
              toggle(ex);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 56,
              padding: 12,
              borderRadius: t.radius.md,
              backgroundColor: on ? t.tint : t.surface,
              borderWidth: 1.5,
              borderColor: on ? t.primary : t.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{ex.name}</Txt>
              <Txt variant="small" color="textMuted">
                {humanize(ex.muscleGroup)} · {humanize(ex.equipment)}
              </Txt>
            </View>
            <Icon name={on ? 'check-circle' : 'plus-circle'} size={22} color={on ? t.primaryText : t.textMuted} />
          </Pressable>
        );
      })}
      <Button
        label={picked.length ? `Add ${plural(picked.length, 'exercise')}` : 'Pick exercises to add'}
        disabled={picked.length === 0}
        onPress={() => {
          onAdd(picked);
          close();
        }}
      />
    </Sheet>
  );
}
