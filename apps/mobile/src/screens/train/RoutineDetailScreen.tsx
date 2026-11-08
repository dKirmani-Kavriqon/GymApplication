import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { humanize, type RoutineExercise } from '@gymverse/shared';
import { Button, Card, Pill, Screen, Stat, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { tapFeedback } from '../../utils/feedback';
import { useLoad } from '../../utils/useLoad';
import { FavouriteButton, Gate, InlineConfirm, emit, kg, useBus, useGymApi } from './common';
import type { ScreenProps } from '../../navigation/featureRoutes';

function ExerciseRow({ item, index }: { item: RoutineExercise; index: number }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const ex = item.exercise;
  return (
    <Card testID={`exercise-${index}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="bodyStrong" color="primaryText">
            {index + 1}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{ex.name}</Txt>
          <Txt variant="small" color="textMuted">
            {humanize(ex.muscleGroup)} · {humanize(ex.equipment)}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pill label={`${item.sets} × ${item.reps}${item.weightKg != null ? ` @ ${kg(item.weightKg)}` : ''}`} tone="primary" />
        <Pill label={`Rest ${item.restSec} s`} tone="muted" />
      </View>
      {ex.instructions.length ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${open ? 'Hide' : 'Show'} how to do ${ex.name}`}
            onPress={() => {
              tapFeedback();
              setOpen((o) => !o);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 }}
          >
            <Txt variant="smallStrong" color="primaryText">
              How to do it
            </Txt>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.primaryText} />
          </Pressable>
          {open
            ? ex.instructions.map((line, i) => (
                <Txt key={i} variant="small">
                  {i + 1}. {line}
                </Txt>
              ))
            : null}
        </>
      ) : null}
    </Card>
  );
}

/** A routine: what's in it, coach note, start button; edit/delete for my own routines. */
export function RoutineDetailScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const { api, gymId, me } = useGymApi();
  const nav = useNav();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.routine(gymId, id), `${gymId}|${id}`);
  useBus('routines:changed', () => void reload());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const mine = !!data && data.kind === 'custom' && data.createdBy.id === me?.user.id;

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteRoutine(gymId, id);
      toast.show({ title: 'Routine deleted' });
      emit('routines:changed');
      nav.pop();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <Screen
      title={data?.name ?? 'Routine'}
      onBack={nav.pop}
      right={data ? <FavouriteButton kind="routine" id={data.id} value={data.favourite} name={data.name} /> : undefined}
      footer={data && data.exercises.length ? <Button label="Start workout" arrow onPress={() => nav.push('WorkoutSession', { routineId: data.id })} testID="start-workout" /> : undefined}
    >
      <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
        {() => {
          const r = data!;
          const totalSets = r.exercises.reduce((s, e) => s + e.sets, 0);
          return (
            <>
              <Card variant="tint" style={{ gap: 14 }}>
                <Pill label={humanize(r.level)} tone="primary" />
                {r.description ? <Txt>{r.description}</Txt> : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Stat value={`~${r.durationMin}`} label="minutes" icon="clock" />
                  <Stat value={r.exercises.length} label="exercises" icon="list" />
                  <Stat value={totalSets} label="sets" icon="repeat" />
                </View>
                {r.assignment ? (
                  <View style={{ gap: 2 }} testID="coach-note">
                    <Txt variant="smallStrong" color="primaryText">
                      Assigned by {r.assignment.by.name ?? 'your coach'}
                    </Txt>
                    {r.assignment.note ? <Txt variant="body">“{r.assignment.note}”</Txt> : null}
                  </View>
                ) : null}
              </Card>

              <Txt variant="h3" color="heading" accessibilityRole="header">
                Exercises
              </Txt>
              {r.exercises.map((e, i) => (
                <ExerciseRow key={`${e.exerciseId}-${i}`} item={e} index={i} />
              ))}

              {mine ? (
                confirming ? (
                  <InlineConfirm
                    testID="confirm-delete"
                    message={`Delete “${r.name}”?`}
                    detail="This removes the routine. Workouts you already logged stay in your history."
                    confirmLabel="Delete"
                    cancelLabel="Keep it"
                    busy={deleting}
                    error={deleteError}
                    onConfirm={remove}
                    onCancel={() => setConfirming(false)}
                  />
                ) : (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button label="Edit" icon="edit-2" variant="outline" size="md" onPress={() => nav.push('RoutineEditor', { id: r.id })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Delete routine" icon="trash-2" variant="danger" size="md" onPress={() => setConfirming(true)} />
                    </View>
                  </View>
                )
              ) : null}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
