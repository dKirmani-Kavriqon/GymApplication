import { useState, type FormEvent } from 'react';
import {
  GOALS,
  MEAL_TYPES,
  humanize,
  labelOf,
  mealIdeaSchema,
  mealPlanSchema,
  type GoalId,
  type Gym,
  type MealIdea,
  type MealPlan,
  type MealType,
} from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { pluralize } from '../lib/format';
import { emptyToNull, numOrNull, splitList, splitLines, validate } from '../lib/validate';
import { Icon } from '../components/Icon';
import { Chip, Empty, ErrorBanner, IconButton, Loading, PageHeader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

interface MealDraft {
  key: number;
  slot: MealType;
  title: string;
  description: string;
  calories: string;
  proteinG: string;
}

let mealKey = 1;
const newMeal = (slot: MealType): MealDraft => ({ key: mealKey++, slot, title: '', description: '', calories: '', proteinG: '' });

function MealPlanForm({ gym, onCreated, onCancel }: { gym: Gym; onCreated: (p: MealPlan) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState<GoalId | ''>('');
  const [description, setDescription] = useState('');
  const [caloriesPerDay, setCaloriesPerDay] = useState('2000');
  const [meals, setMeals] = useState<MealDraft[]>(() => [newMeal('breakfast')]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: number, patch: Partial<MealDraft>) => setMeals((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const total = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);

  function addMeal() {
    const used = meals.map((m) => m.slot);
    setMeals((ms) => [...ms, newMeal(MEAL_TYPES.find((t) => !used.includes(t)) ?? 'snack')]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(mealPlanSchema, {
      title,
      goal: goal || null,
      description,
      caloriesPerDay: numOrNull(caloriesPerDay),
      meals: meals.map((m) => ({
        slot: m.slot,
        title: m.title,
        description: m.description,
        calories: numOrNull(m.calories),
        proteinG: numOrNull(m.proteinG),
      })),
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<MealPlan>(`/gyms/${gym.id}/meal-plans`, parsed.data));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label="New meal plan">
      <h2>New meal plan</h2>
      <div className="form-grid">
        <label className="field span-2">
          <span>Plan title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="High-protein vegetarian" />
        </label>
        <label className="field">
          <span>Goal</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value as GoalId | '')}>
            <option value="">Any goal</option>
            {GOALS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Calories per day</span>
          <input type="number" min={800} max={6000} value={caloriesPerDay} onChange={(e) => setCaloriesPerDay(e.target.value)} />
        </label>
        <label className="field span-4">
          <span>Description</span>
          <textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      <div className="stack-sm">
        <div className="section-head">
          <h3>Meals</h3>
          <span className="muted small">
            {total} kcal of {caloriesPerDay || '–'} planned
          </span>
        </div>
        {meals.map((m, i) => (
          <div key={m.key} className="meal-row" data-testid="meal-row">
            <label className="field">
              <span>Slot</span>
              <select aria-label={`Meal ${i + 1} slot`} value={m.slot} onChange={(e) => update(m.key, { slot: e.target.value as MealType })}>
                {MEAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field meal-title">
              <span>Meal</span>
              <input aria-label={`Meal ${i + 1} title`} value={m.title} onChange={(e) => update(m.key, { title: e.target.value })} placeholder="Paneer bhurji + 2 rotis" />
            </label>
            <label className="field">
              <span>kcal</span>
              <input aria-label={`Meal ${i + 1} calories`} type="number" min={0} value={m.calories} onChange={(e) => update(m.key, { calories: e.target.value })} />
            </label>
            <label className="field">
              <span>Protein (g)</span>
              <input aria-label={`Meal ${i + 1} protein`} inputMode="decimal" value={m.proteinG} onChange={(e) => update(m.key, { proteinG: e.target.value })} />
            </label>
            <label className="field meal-desc">
              <span>Notes</span>
              <input aria-label={`Meal ${i + 1} notes`} value={m.description} onChange={(e) => update(m.key, { description: e.target.value })} />
            </label>
            <span className="meal-remove">
              <IconButton icon="trash" tone="danger" label={`Remove meal ${i + 1}`} onClick={() => setMeals((ms) => ms.filter((x) => x.key !== m.key))} disabled={meals.length === 1} />
            </span>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-small btn-secondary" onClick={addMeal} disabled={meals.length >= 12}>
            <Icon name="plus" size={16} /> Add meal
          </button>
        </div>
      </div>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Create meal plan'}
        </button>
      </div>
    </form>
  );
}

function MealIdeaForm({ gym, onCreated, onCancel }: { gym: Gym; onCreated: (m: MealIdea) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    title: '',
    mealType: 'breakfast' as MealType,
    calories: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    ingredients: '',
    steps: '',
    imageUrl: '',
    tags: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(mealIdeaSchema, {
      title: f.title,
      mealType: f.mealType,
      calories: numOrNull(f.calories),
      proteinG: numOrNull(f.proteinG),
      carbsG: numOrNull(f.carbsG) ?? 0,
      fatG: numOrNull(f.fatG) ?? 0,
      ingredients: splitLines(f.ingredients),
      steps: splitLines(f.steps),
      imageUrl: emptyToNull(f.imageUrl),
      tags: splitList(f.tags, /,/),
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<MealIdea>(`/gyms/${gym.id}/meal-ideas`, parsed.data));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label="New meal idea">
      <h2>New meal idea</h2>
      <div className="form-grid">
        <label className="field span-2">
          <span>Title</span>
          <input value={f.title} onChange={set('title')} maxLength={80} placeholder="Overnight oats" />
        </label>
        <label className="field span-2">
          <span>Meal type</span>
          <select value={f.mealType} onChange={set('mealType')}>
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Calories</span>
          <input type="number" min={0} value={f.calories} onChange={set('calories')} />
        </label>
        <label className="field">
          <span>Protein (g)</span>
          <input inputMode="decimal" value={f.proteinG} onChange={set('proteinG')} />
        </label>
        <label className="field">
          <span>Carbs (g)</span>
          <input inputMode="decimal" value={f.carbsG} onChange={set('carbsG')} />
        </label>
        <label className="field">
          <span>Fat (g)</span>
          <input inputMode="decimal" value={f.fatG} onChange={set('fatG')} />
        </label>
        <label className="field span-2">
          <span>Ingredients (one per line)</span>
          <textarea rows={4} value={f.ingredients} onChange={set('ingredients')} />
        </label>
        <label className="field span-2">
          <span>Steps (one per line)</span>
          <textarea rows={4} value={f.steps} onChange={set('steps')} />
        </label>
        <label className="field span-2">
          <span>Image URL</span>
          <input inputMode="url" value={f.imageUrl} onChange={set('imageUrl')} placeholder="https://…" />
        </label>
        <label className="field span-2">
          <span>Tags (comma separated)</span>
          <input value={f.tags} onChange={set('tags')} placeholder="vegetarian, quick" />
        </label>
      </div>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Add meal idea'}
        </button>
      </div>
    </form>
  );
}

export function Nutrition({ gym }: { gym: Gym }) {
  const [tab, setTab] = useState<'plans' | 'ideas'>('plans');
  const plans = useApiData<{ mealPlans: MealPlan[] }>(`/gyms/${gym.id}/meal-plans`);
  const ideas = useApiData<{ mealIdeas: MealIdea[] }>(`/gyms/${gym.id}/meal-ideas`);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const planList = plans.data?.mealPlans ?? [];
  const ideaList = ideas.data?.mealIdeas ?? [];

  async function removePlan(p: MealPlan) {
    if (!window.confirm(`Delete the meal plan "${p.title}"?`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/meal-plans/${p.id}`);
      plans.setData((d) => d && { mealPlans: d.mealPlans.filter((x) => x.id !== p.id) });
      toast('Meal plan deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function removeIdea(m: MealIdea) {
    if (!window.confirm(`Delete the meal idea "${m.title}"?`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/meal-ideas/${m.id}`);
      ideas.setData((d) => d && { mealIdeas: d.mealIdeas.filter((x) => x.id !== m.id) });
      toast('Meal idea deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Nutrition"
        subtitle="Day plans and simple meal ideas for your members."
        actions={
          !adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={18} /> {tab === 'plans' ? 'New meal plan' : 'New meal idea'}
            </button>
          )
        }
      />
      <Tabs
        label="Nutrition"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setAdding(false);
        }}
        tabs={[
          { id: 'plans', label: 'Meal plans', count: plans.data ? planList.length : undefined },
          { id: 'ideas', label: 'Meal ideas', count: ideas.data ? ideaList.length : undefined },
        ]}
      />
      <ErrorBanner message={(tab === 'plans' ? plans.error : ideas.error) ?? actionError} />

      {tab === 'plans' && (
        <>
          {adding && (
            <MealPlanForm
              gym={gym}
              onCancel={() => setAdding(false)}
              onCreated={(p) => {
                setAdding(false);
                toast('Meal plan created');
                plans.setData((d) => ({ mealPlans: [p, ...(d?.mealPlans ?? [])] }));
              }}
            />
          )}
          {plans.loading && !plans.data ? (
            <Loading />
          ) : planList.length === 0 ? (
            <Empty icon="leaf">No meal plans yet.</Empty>
          ) : (
            <div className="routine-grid">
              {planList.map((p) => (
                <article key={p.id} className="card stack-sm" data-testid="meal-plan">
                  <div className="section-head">
                    <h3>{p.title}</h3>
                    <Chip tone="brand">{p.caloriesPerDay} kcal/day</Chip>
                  </div>
                  <span className="muted small">
                    {p.goal ? labelOf(GOALS, p.goal) : 'Any goal'} · {pluralize(p.meals.length, 'meal')}
                  </span>
                  {p.description && <p className="small">{p.description}</p>}
                  <ul className="set-summary">
                    {p.meals.map((m, i) => (
                      <li key={i}>
                        <span>
                          <strong>{humanize(m.slot)}</strong> · {m.title}
                        </span>
                        <span className="muted">
                          {m.calories} kcal · {m.proteinG} g protein
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="card-actions">
                    <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => removePlan(p)} aria-label={`Delete ${p.title}`}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'ideas' && (
        <>
          {adding && (
            <MealIdeaForm
              gym={gym}
              onCancel={() => setAdding(false)}
              onCreated={(m) => {
                setAdding(false);
                toast('Meal idea added');
                ideas.setData((d) => ({ mealIdeas: [m, ...(d?.mealIdeas ?? [])] }));
              }}
            />
          )}
          {ideas.loading && !ideas.data ? (
            <Loading />
          ) : ideaList.length === 0 ? (
            <Empty icon="leaf">No meal ideas yet.</Empty>
          ) : (
            <div className="resource-grid">
              {ideaList.map((m) => (
                <article key={m.id} className="card stack-sm" data-testid="meal-idea">
                  <div className="section-head">
                    <h3>{m.title}</h3>
                    <Chip tone="muted">{humanize(m.mealType)}</Chip>
                  </div>
                  <div className="macro-row" aria-label="Macros">
                    <span>
                      <strong>{m.calories}</strong> kcal
                    </span>
                    <span>
                      <strong>{m.proteinG}</strong> g protein
                    </span>
                    <span>
                      <strong>{m.carbsG}</strong> g carbs
                    </span>
                    <span>
                      <strong>{m.fatG}</strong> g fat
                    </span>
                  </div>
                  {m.ingredients.length > 0 && <p className="muted small clamp-2">{m.ingredients.join(' · ')}</p>}
                  <div className="card-actions">
                    <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => removeIdea(m)} aria-label={`Delete ${m.title}`}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
