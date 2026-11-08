import { useMemo, useState, type FormEvent } from 'react';
import {
  EQUIPMENT,
  LEVELS,
  MUSCLE_GROUPS,
  assignRoutineSchema,
  exerciseSchema,
  humanize,
  routineSchema,
  type Equipment,
  type Exercise,
  type Gym,
  type Level,
  type MemberRow,
  type MuscleGroup,
  type Role,
  type Routine,
  type RoutinesResponse,
} from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { isAdmin } from '../lib/roles';
import { pluralize } from '../lib/format';
import { emptyToNull, numOrNull, splitLines, validate } from '../lib/validate';
import { estimateMinutes } from '../lib/workouts';
import { Icon } from '../components/Icon';
import { Chip, Empty, ErrorBanner, IconButton, Loading, Modal, PageHeader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

interface Props {
  gym: Gym;
  role: Role;
  myUserId: string;
}

interface RowDraft {
  key: number;
  exerciseId: string;
  sets: string;
  reps: string;
  weightKg: string;
  restSec: string;
}

let rowKey = 1;
const newRow = (exerciseId: string): RowDraft => ({ key: rowKey++, exerciseId, sets: '3', reps: '10', weightKg: '', restSec: '60' });

// ---------- routine editor ----------

function RoutineEditor({
  gym,
  exercises,
  routine,
  onSaved,
  onCancel,
}: {
  gym: Gym;
  exercises: Exercise[];
  routine: Routine | null;
  onSaved: (r: Routine, created: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(routine?.name ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [level, setLevel] = useState<Level>(routine?.level ?? 'beginner');
  const [rows, setRows] = useState<RowDraft[]>(() =>
    (routine?.exercises ?? []).map((e) => ({
      key: rowKey++,
      exerciseId: e.exerciseId,
      sets: String(e.sets),
      reps: String(e.reps),
      weightKg: e.weightKg == null ? '' : String(e.weightKg),
      restSec: String(e.restSec),
    })),
  );
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const exName = (id: string) => byId.get(id)?.name ?? routine?.exercises.find((e) => e.exerciseId === id)?.exercise.name ?? id;

  const update = (key: number, patch: Partial<RowDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function addExercise() {
    if (!pick) return;
    setRows((rs) => [...rs, newRow(pick)]);
    setPick('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(routineSchema, {
      name,
      description: emptyToNull(description),
      level,
      kind: 'preset',
      exercises: rows.map((r) => ({
        exerciseId: r.exerciseId,
        sets: Number(r.sets),
        reps: Number(r.reps),
        weightKg: numOrNull(r.weightKg),
        restSec: Number(r.restSec || 0),
      })),
    });
    if (!parsed.ok) {
      setError(rows.length === 0 ? 'Add at least one exercise.' : parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = routine
        ? await api.patch<Routine>(`/gyms/${gym.id}/routines/${routine.id}`, parsed.data)
        : await api.post<Routine>(`/gyms/${gym.id}/routines`, parsed.data);
      onSaved(saved, !routine);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const groups = MUSCLE_GROUPS.map((m) => ({ m, list: exercises.filter((x) => x.muscleGroup === m) })).filter((g) => g.list.length);
  const minutes = estimateMinutes(rows.map((r) => ({ sets: Number(r.sets), restSec: Number(r.restSec) })));

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={routine ? 'Edit routine' : 'New routine'}>
      <div className="section-head">
        <h2>{routine ? `Edit ${routine.name}` : 'New preset routine'}</h2>
        <span className="muted small">
          {pluralize(rows.length, 'exercise')} · ~{minutes} min
        </span>
      </div>
      <div className="form-grid">
        <label className="field span-2">
          <span>Routine name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Leg day" />
        </label>
        <label className="field">
          <span>Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {humanize(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-4">
          <span>Description</span>
          <textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Squat-focused lower body session" />
        </label>
      </div>

      <div className="stack-sm">
        <h3>Exercises</h3>
        {rows.length === 0 ? (
          <p className="muted small">Pick exercises from the library below. Each gets its own sets, reps, weight and rest.</p>
        ) : (
          <div className="routine-rows">
            <div className="routine-row routine-row-head" aria-hidden>
              <span>Exercise</span>
              <span>Sets</span>
              <span>Reps</span>
              <span>Weight (kg)</span>
              <span>Rest (s)</span>
              <span />
            </div>
            {rows.map((r, i) => {
              const n = exName(r.exerciseId);
              return (
                <div key={r.key} className="routine-row" data-testid="routine-row">
                  <span className="routine-ex">
                    <span className="row-num">{i + 1}</span>
                    {n}
                  </span>
                  <input aria-label={`Sets for ${n}`} type="number" min={1} max={10} value={r.sets} onChange={(e) => update(r.key, { sets: e.target.value })} />
                  <input aria-label={`Reps for ${n}`} type="number" min={1} max={100} value={r.reps} onChange={(e) => update(r.key, { reps: e.target.value })} />
                  <input
                    aria-label={`Weight for ${n}`}
                    inputMode="decimal"
                    placeholder="–"
                    value={r.weightKg}
                    onChange={(e) => update(r.key, { weightKg: e.target.value })}
                  />
                  <input
                    aria-label={`Rest for ${n}`}
                    type="number"
                    min={0}
                    max={600}
                    step={15}
                    value={r.restSec}
                    onChange={(e) => update(r.key, { restSec: e.target.value })}
                  />
                  <span className="row-actions">
                    <IconButton icon="arrowUp" label={`Move ${n} up`} onClick={() => move(i, -1)} disabled={i === 0} />
                    <IconButton icon="arrowDown" label={`Move ${n} down`} onClick={() => move(i, 1)} disabled={i === rows.length - 1} />
                    <IconButton icon="trash" tone="danger" label={`Remove ${n}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="inline-add">
          <select aria-label="Exercise to add" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose an exercise…</option>
            {groups.map((g) => (
              <optgroup key={g.m} label={humanize(g.m)}>
                {g.list.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={addExercise} disabled={!pick}>
            <Icon name="plus" size={16} /> Add exercise
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : routine ? 'Save changes' : 'Create routine'}
        </button>
      </div>
    </form>
  );
}

// ---------- assign ----------

function AssignDialog({ gym, routine, onClose }: { gym: Gym; routine: Routine; onClose: () => void }) {
  const members = useApiData<{ members: MemberRow[] }>(`/gyms/${gym.id}/members`);
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const list = (members.data?.members ?? []).filter((m) => m.role === 'member');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(assignRoutineSchema, { userId, note: emptyToNull(note) });
    if (!parsed.ok) {
      setError(userId ? parsed.error : 'Choose a member.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gyms/${gym.id}/routines/${routine.id}/assign`, parsed.data);
      const who = list.find((m) => m.userId === userId);
      toast(`${routine.name} assigned to ${who?.name ?? who?.phone ?? 'member'}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Assign ${routine.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate aria-label="Assign routine">
        <p className="muted small">The member gets a notification and sees it under “Assigned to you” in the app.</p>
        <ErrorBanner message={members.error} />
        <label className="field">
          <span>Member</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={members.loading && !members.data}>
            <option value="">{members.loading && !members.data ? 'Loading members…' : 'Choose a member…'}</option>
            {list.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? 'Unnamed'} · {m.phone}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Note for the member</span>
          <textarea rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Twice a week, add 2.5 kg when it feels easy." />
        </label>
        <ErrorBanner message={error} />
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Assigning…' : 'Assign routine'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- exercise library ----------

function ExerciseForm({ gym, onCreated, onCancel }: { gym: Gym; onCreated: (e: Exercise) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>('chest');
  const [equipment, setEquipment] = useState<Equipment>('none');
  const [instructions, setInstructions] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(exerciseSchema, {
      name,
      muscleGroup,
      equipment,
      instructions: splitLines(instructions),
      videoUrl: emptyToNull(videoUrl),
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<Exercise>(`/gyms/${gym.id}/exercises`, parsed.data));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label="New exercise">
      <h2>Add a gym exercise</h2>
      <div className="form-grid">
        <label className="field span-2">
          <span>Exercise name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Sled push" />
        </label>
        <label className="field">
          <span>Muscle group</span>
          <select value={muscleGroup} onChange={(e) => setMuscleGroup(e.target.value as MuscleGroup)}>
            {MUSCLE_GROUPS.map((m) => (
              <option key={m} value={m}>
                {humanize(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Equipment</span>
          <select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {EQUIPMENT.map((m) => (
              <option key={m} value={m}>
                {humanize(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-4">
          <span>Instructions (one step per line)</span>
          <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <label className="field span-4">
          <span>Video URL</span>
          <input inputMode="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" />
        </label>
      </div>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Add exercise'}
        </button>
      </div>
    </form>
  );
}

function ExerciseLibrary({
  gym,
  exercises,
  loading,
  onCreated,
}: {
  gym: Gym;
  exercises: Exercise[];
  loading: boolean;
  onCreated: (e: Exercise) => void;
}) {
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const needle = q.trim().toLowerCase();
  const list = exercises.filter((e) => (muscle === 'all' || e.muscleGroup === muscle) && (!needle || e.name.toLowerCase().includes(needle)));

  return (
    <div className="stack">
      {adding && (
        <ExerciseForm
          gym={gym}
          onCancel={() => setAdding(false)}
          onCreated={(e) => {
            setAdding(false);
            onCreated(e);
            toast(`${e.name} added to the library`);
          }}
        />
      )}
      <section className="card stack">
        <div className="toolbar">
          <input type="search" className="search" placeholder="Search exercises" aria-label="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
          {!adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add exercise
            </button>
          )}
        </div>
        <div className="chip-row" role="group" aria-label="Filter by muscle group">
          {(['all', ...MUSCLE_GROUPS] as const).map((m) => (
            <button key={m} type="button" className="filter-chip" aria-pressed={muscle === m} onClick={() => setMuscle(m)}>
              {m === 'all' ? 'All' : humanize(m)}
            </button>
          ))}
        </div>
        {loading && exercises.length === 0 ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="dumbbell">No exercises match.</Empty>
        ) : (
          <ul className="exercise-grid">
            {list.map((e) => (
              <li key={e.id} className="exercise-card" data-testid="exercise">
                <div className="exercise-top">
                  <strong>{e.name}</strong>
                  {e.builtIn ? <Chip tone="muted">Built-in</Chip> : <Chip tone="brand">Your gym</Chip>}
                </div>
                <span className="muted small">
                  {humanize(e.muscleGroup)} · {humanize(e.equipment)}
                </span>
                {e.instructions.length > 0 && <p className="small clamp-2">{e.instructions.join(' ')}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- page ----------

export function Workouts({ gym, role, myUserId }: Props) {
  const [tab, setTab] = useState<'routines' | 'library'>('routines');
  const routines = useApiData<RoutinesResponse>(`/gyms/${gym.id}/routines`);
  const ex = useApiData<{ exercises: Exercise[] }>(`/gyms/${gym.id}/exercises`);
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Routine | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const admin = isAdmin(role);
  const presets = routines.data?.presets ?? [];
  const exercises = ex.data?.exercises ?? [];

  async function remove(r: Routine) {
    if (!window.confirm(`Delete "${r.name}"? Members who saved it will no longer see it.`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/routines/${r.id}`);
      routines.setData((d) => d && { ...d, presets: d.presets.filter((x) => x.id !== r.id) });
      toast('Routine deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Workouts"
        subtitle="Publish preset routines, keep your exercise library, and assign plans to members."
        actions={
          tab === 'routines' &&
          editing === null && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={18} /> New routine
            </button>
          )
        }
      />
      <Tabs
        label="Workouts"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'routines', label: 'Routines', count: routines.data ? presets.length : undefined },
          { id: 'library', label: 'Exercise library', count: ex.data ? exercises.length : undefined },
        ]}
      />
      <ErrorBanner message={routines.error ?? ex.error ?? actionError} />

      {tab === 'routines' && (
        <>
          {editing !== null && (
            <RoutineEditor
              key={editing === 'new' ? 'new' : editing.id}
              gym={gym}
              exercises={exercises}
              routine={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={(r, created) => {
                setEditing(null);
                toast(created ? 'Routine created' : 'Routine saved');
                routines.setData((d) => {
                  const base = d ?? { assigned: [], presets: [], mine: [] };
                  return { ...base, presets: created ? [r, ...base.presets] : base.presets.map((x) => (x.id === r.id ? r : x)) };
                });
              }}
            />
          )}
          {routines.loading && !routines.data ? (
            <Loading />
          ) : presets.length === 0 ? (
            <Empty icon="dumbbell">No preset routines yet. Create one and members will see it under Workouts.</Empty>
          ) : (
            <div className="routine-grid">
              {presets.map((r) => (
                <article key={r.id} className="card routine-card" data-testid="routine-card">
                  <div className="section-head">
                    <h3>{r.name}</h3>
                    <Chip tone="brand">{humanize(r.level)}</Chip>
                  </div>
                  {r.description && <p className="muted small">{r.description}</p>}
                  <div className="muted small">
                    {pluralize(r.exercises.length, 'exercise')} · ~{r.durationMin} min · by {r.createdBy.name ?? 'staff'}
                  </div>
                  <ol className="routine-ex-list">
                    {r.exercises.slice(0, 5).map((e, i) => (
                      <li key={`${e.exerciseId}-${i}`}>
                        <span>{e.exercise.name}</span>
                        <span className="muted">
                          {e.sets} × {e.reps}
                          {e.weightKg ? ` · ${e.weightKg} kg` : ''}
                        </span>
                      </li>
                    ))}
                    {r.exercises.length > 5 && <li className="muted">+{r.exercises.length - 5} more</li>}
                  </ol>
                  <div className="card-actions">
                    <button type="button" className="btn btn-small btn-primary" onClick={() => setAssigning(r)}>
                      Assign
                    </button>
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    {(admin || r.createdBy.id === myUserId) && (
                      <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(r)}>
                        Delete
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'library' && (
        <ExerciseLibrary
          gym={gym}
          exercises={exercises}
          loading={ex.loading}
          onCreated={(e) => ex.setData((d) => ({ exercises: [...(d?.exercises ?? []), e] }))}
        />
      )}

      {assigning && <AssignDialog gym={gym} routine={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}
