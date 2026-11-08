import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { LEVELS, humanize, routineSchema, type Exercise, type Level, type Routine } from '@gymverse/shared';
import { Button, Card, ErrorText, Field, IconButton, Screen, Segmented, Stepper, Txt } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useNav } from '../../navigation/Nav';
import { Gate, emit, useGymApi } from './common';
import { ExercisePicker } from './parts';
import type { ScreenProps } from '../../navigation/featureRoutes';

interface Row {
  key: string;
  exercise: Exercise;
  sets: number;
  reps: number;
  weightKg: number;
  restSec: number;
}

let rowSeq = 0;
const newRow = (exercise: Exercise, over: Partial<Row> = {}): Row => ({ key: `row-${++rowSeq}`, exercise, sets: 3, reps: 10, weightKg: 0, restSec: 60, ...over });

function fromRoutine(r: Routine): Row[] {
  return r.exercises.map((e) => newRow(e.exercise, { sets: e.sets, reps: e.reps, weightKg: e.weightKg ?? 0, restSec: e.restSec }));
}

/** Build (or edit) your own routine. Validated with the shared routineSchema. */
export function RoutineEditorScreen({ params }: ScreenProps) {
  const id = params.id ? String(params.id) : null;
  const { api, gymId } = useGymApi();
  const nav = useNav();
  const toast = useToast();

  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<Level>('beginner');
  const [rows, setRows] = useState<Row[]>([]);
  const [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; exercises?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api.routine(gymId, id);
      setName(r.name);
      setDescription(r.description ?? '');
      setLevel(r.level);
      setRows(fromRoutine(r));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id, gymId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    const parsed = routineSchema.safeParse({
      name,
      description: description.trim() ? description : null,
      level,
      kind: 'custom',
      exercises: rows.map((r) => ({ exerciseId: r.exercise.id, sets: r.sets, reps: r.reps, weightKg: r.weightKg > 0 ? r.weightKg : null, restSec: r.restSec })),
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'name' && !next.name) next.name = name.trim() ? 'Use 2 to 60 letters for the name.' : 'Give your routine a name.';
        else if (field === 'exercises' && !next.exercises) next.exercises = rows.length === 0 ? 'Add at least one exercise.' : rows.length > 20 ? 'A routine can have up to 20 exercises.' : 'Check the sets, reps and weight.';
        else if (field === 'description' && !next.form) next.form = 'Keep the description under 300 letters.';
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = id ? await api.updateRoutine(gymId, id, parsed.data) : await api.createRoutine(gymId, parsed.data);
      toast.show({ title: id ? 'Routine saved' : 'Routine created', body: saved.name });
      emit('routines:changed');
      nav.pop();
      if (!id) nav.push('RoutineDetail', { id: saved.id });
    } catch (err) {
      setErrors({ form: (err as Error).message });
      setSaving(false);
    }
  }

  return (
    <Screen
      title={id ? 'Edit routine' : 'Build a routine'}
      onBack={nav.pop}
      footer={!loading && !loadError ? <Button label={id ? 'Save changes' : 'Save routine'} onPress={save} loading={saving} testID="save-routine" /> : undefined}
    >
      <Gate loading={loading} error={loadError} ready={!loading && !loadError} onRetry={load}>
        {() => (
          <>
            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Monday upper body" error={errors.name} maxLength={60} />
            <Field label="Description (optional)" value={description} onChangeText={setDescription} placeholder="What is this routine for?" multiline maxLength={300} />
            <View style={{ gap: 6 }}>
              <Txt variant="smallStrong">Level</Txt>
              <Segmented<Level> options={LEVELS.map((l) => ({ id: l, label: humanize(l) }))} value={level} onChange={setLevel} />
            </View>

            <Txt variant="h3" color="heading" accessibilityRole="header">
              Exercises
            </Txt>
            {rows.length === 0 ? (
              <Txt color="textMuted">No exercises yet. Add a few to get started.</Txt>
            ) : (
              rows.map((r, i) => (
                <Card key={r.key} testID={`row-${i}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">
                        {i + 1}. {r.exercise.name}
                      </Txt>
                      <Txt variant="small" color="textMuted">
                        {humanize(r.exercise.muscleGroup)} · {humanize(r.exercise.equipment)}
                      </Txt>
                    </View>
                    <IconButton icon="trash-2" label={`Remove ${r.exercise.name}`} onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                  </View>
                  <Stepper label="Sets" value={r.sets} min={1} max={10} onChange={(v) => update(r.key, { sets: v })} />
                  <Stepper label="Reps" value={r.reps} min={1} max={100} onChange={(v) => update(r.key, { reps: v })} />
                  <Stepper label="Weight" unit="kg" value={r.weightKg} step={2.5} min={0} max={500} onChange={(v) => update(r.key, { weightKg: v })} />
                  <Stepper label="Rest" unit="s" value={r.restSec} step={15} min={0} max={600} onChange={(v) => update(r.key, { restSec: v })} />
                </Card>
              ))
            )}
            <ErrorText message={errors.exercises} />
            <Button label="Add exercises" icon="plus" variant="soft" onPress={() => setPicker(true)} testID="add-exercises" />
            <ErrorText message={errors.form} />
            <ExercisePicker visible={picker} onClose={() => setPicker(false)} onAdd={(list) => setRows((rs) => [...rs, ...list.map((e) => newRow(e))])} />
          </>
        )}
      </Gate>
    </Screen>
  );
}
