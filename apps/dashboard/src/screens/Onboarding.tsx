import { useState, type FormEvent } from 'react';
import { formatInr, type Gym, type Plan } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { rupeesToPaise } from '../lib/format';
import { PLAN_TEMPLATES, type PlanDraft } from '../lib/templates';
import { parseBenefits } from './Plans';
import { BrandingStudio } from './Branding';
import { QrPoster } from '../components/QrPoster';
import { ErrorBanner, PageHeader } from '../components/ui';
import { Icon, StarMark } from '../components/Icon';

type Step = 'basics' | 'branding' | 'plans' | 'done';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'basics', label: 'Your gym' },
  { id: 'branding', label: 'Branding' },
  { id: 'plans', label: 'Plans' },
  { id: 'done', label: 'Go live' },
];

interface Props {
  onFinish: (gym: Gym) => void;
  onCancel?: () => void;
}

function Basics({ onCreated, onCancel }: { onCreated: (g: Gym) => void; onCancel?: () => void }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<Gym>('/gyms', { name: name.trim(), city: city.trim() }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack narrow" onSubmit={submit} aria-label="Create your gym">
      <PageHeader title="Let's set up your gym" subtitle="Step 1 of 3 · This takes about two minutes." />
      <label className="field">
        <span>Gym name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="Flex Fitness" autoFocus />
      </label>
      <label className="field">
        <span>City</span>
        <input value={city} onChange={(e) => setCity(e.target.value)} required minLength={2} maxLength={60} placeholder="Pune" />
      </label>
      <ErrorBanner message={error} />
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create gym'}
        </button>
      </div>
    </form>
  );
}

function PlansStep({ gym, onDone }: { gym: Gym; onDone: () => void }) {
  const [drafts, setDrafts] = useState<PlanDraft[]>(() => PLAN_TEMPLATES.map((t) => ({ ...t, include: true })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<PlanDraft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const chosen = drafts.map((d, i) => ({ d, i })).filter(({ d }) => d.include);
    for (const { d } of chosen) {
      if (rupeesToPaise(d.priceRupees) === null) {
        setError(`Enter a valid price for ${d.name || 'each plan'}`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const created: number[] = [];
    try {
      for (const { d, i } of chosen) {
        await api.post<Plan>(`/gyms/${gym.id}/plans`, {
          name: d.name.trim(),
          durationDays: Number(d.durationDays),
          pricePaise: rupeesToPaise(d.priceRupees),
          benefits: parseBenefits(d.benefits),
        });
        created.push(i);
      }
      onDone();
    } catch (err) {
      // Drop the plans that were created so a retry doesn't duplicate them.
      setDrafts((ds) => ds.filter((_, j) => !created.includes(j)));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-label="Membership plans">
      <PageHeader title="Membership plans" subtitle="Step 3 of 3 · We've filled in common plans. Adjust prices to match your gym." />
      <div className="plan-drafts">
        {drafts.map((d, i) => (
          <div key={i} className={`plan-draft${d.include ? '' : ' is-off'}`} data-testid="plan-draft">
            <label className="checkbox">
              <input type="checkbox" checked={d.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Include plan ${i + 1}`} />
            </label>
            <label className="field">
              <span>Name</span>
              <input value={d.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`Plan ${i + 1} name`} />
            </label>
            <label className="field">
              <span>Days</span>
              <input
                type="number"
                min={1}
                max={730}
                value={d.durationDays}
                onChange={(e) => update(i, { durationDays: Number(e.target.value) })}
                aria-label={`Plan ${i + 1} days`}
              />
            </label>
            <label className="field">
              <span>Price (₹)</span>
              <input
                inputMode="decimal"
                value={d.priceRupees}
                onChange={(e) => update(i, { priceRupees: e.target.value })}
                aria-label={`Plan ${i + 1} price`}
              />
            </label>
            <div className="plan-draft-preview muted small">
              {rupeesToPaise(d.priceRupees) !== null ? formatInr(rupeesToPaise(d.priceRupees)!) : '–'}
            </div>
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setDrafts((ds) => [...ds, { include: true, name: '', durationDays: 30, priceRupees: '', benefits: '' }])}
        >
          <Icon name="plus" size={16} /> Add another plan
        </button>
      </div>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={busy}>
          Skip for now
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : `Create ${drafts.filter((d) => d.include).length} plans`}
        </button>
      </div>
    </form>
  );
}

export function Onboarding({ onFinish, onCancel }: Props) {
  const [step, setStep] = useState<Step>('basics');
  const [gym, setGym] = useState<Gym | null>(null);
  const index = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="onboarding">
      <div className="brand-mark">
        <StarMark size={22} className="brand-star" /> GymVerse
      </div>
      <ol className="stepper" aria-label="Onboarding progress">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < index ? 'is-done' : i === index ? 'is-current' : ''} aria-current={i === index ? 'step' : undefined}>
            <span className="stepper-num">{i < index ? <Icon name="check" size={14} /> : i + 1}</span> {s.label}
          </li>
        ))}
      </ol>
      {step === 'basics' && (
        <Basics
          onCancel={onCancel}
          onCreated={(g) => {
            setGym(g);
            setStep('branding');
          }}
        />
      )}
      {step === 'branding' && gym && (
        <BrandingStudio
          gym={gym}
          canEdit
          variant="onboarding"
          onSkip={() => setStep('plans')}
          onSaved={(g) => {
            setGym(g);
            setStep('plans');
          }}
        />
      )}
      {step === 'plans' && gym && <PlansStep gym={gym} onDone={() => setStep('done')} />}
      {step === 'done' && gym && (
        <div className="stack-lg">
          <div className="card done-hero">
            <div className="done-mark"><StarMark size={44} /></div>
            <h1>{gym.branding.gymName} is live!</h1>
            <p className="muted">Members join with this code, or by scanning the poster below.</p>
            <div className="join-code join-code-xl" data-testid="done-join-code">
              {gym.joinCode}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => onFinish(gym)}>
              Go to dashboard
            </button>
          </div>
          <QrPoster gym={gym} />
        </div>
      )}
    </div>
  );
}
