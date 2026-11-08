import { useState, type FormEvent } from 'react';
import { formatInr, type Gym, type Plan, type Role } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { rupeesToPaise } from '../lib/format';
import { isAdmin } from '../lib/roles';
import { Empty, ErrorBanner, Loading, PageHeader, Tabs } from '../components/ui';
import { Coupons } from './Coupons';
import { stagger } from '../lib/motion';
import { useToast } from '../components/Toast';

/** Splits a "one benefit per line" textarea into the API's benefits array. */
export function parseBenefits(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function CreatePlanForm({ gym, onCreated }: { gym: Gym; onCreated: (p: Plan) => void }) {
  const [name, setName] = useState('');
  const [durationDays, setDurationDays] = useState('30');
  const [price, setPrice] = useState('');
  const [benefits, setBenefits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pricePaise = rupeesToPaise(price);
    if (pricePaise === null) {
      setError('Enter a price in rupees, like 1499');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const plan = await api.post<Plan>(`/gyms/${gym.id}/plans`, {
        name: name.trim(),
        durationDays: Number(durationDays),
        pricePaise,
        benefits: parseBenefits(benefits),
      });
      setName('');
      setPrice('');
      setBenefits('');
      onCreated(plan);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-label="Create plan">
      <h2>New plan</h2>
      <div className="form-grid">
        <label className="field span-2">
          <span>Plan name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly" required minLength={2} maxLength={40} />
        </label>
        <label className="field">
          <span>Duration (days)</span>
          <input type="number" min={1} max={730} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} required />
        </label>
        <label className="field">
          <span>Price (₹)</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1499" required />
        </label>
        <label className="field span-4">
          <span>Benefits (one per line)</span>
          <textarea rows={3} value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder={'Full gym access\nLocker'} />
        </label>
      </div>
      <ErrorBanner message={error} />
      <div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create plan'}
        </button>
      </div>
    </form>
  );
}

export function Plans({ gym, role }: { gym: Gym; role: Role }) {
  const { data, error, loading, setData } = useApiData<{ plans: Plan[] }>(`/gyms/${gym.id}/plans`);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'plans' | 'coupons'>('plans');
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const admin = isAdmin(role);
  const plans = data?.plans ?? [];

  async function archive(p: Plan) {
    if (!window.confirm(`Archive "${p.name}"? Members can no longer buy it; existing memberships stay valid.`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/plans/${p.id}`);
      setData((d) => d && { plans: d.plans.filter((x) => x.id !== p.id) });
      toast('Plan archived');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Plans"
        subtitle={tab === 'coupons' ? 'Discount codes members can use at checkout' : 'Membership plans members can buy in the app'}
        actions={
          admin &&
          tab === 'plans' && (
            <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? 'Close' : 'New plan'}
            </button>
          )
        }
      />
      {admin && (
        <Tabs
          label="Plans and coupons"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'plans', label: 'Plans' },
            { id: 'coupons', label: 'Coupons' },
          ]}
        />
      )}
      {tab === 'coupons' && admin ? (
        <Coupons gym={gym} plans={plans} />
      ) : (
        renderPlansList()
      )}
    </div>
  );

  function renderPlansList() {
    return (
      <>
      {admin && showForm && (
        <CreatePlanForm
          gym={gym}
          onCreated={(p) => {
            toast('Plan created');
            setShowForm(false);
            setData((d) => ({ plans: [...(d?.plans ?? []), p].sort((a, b) => a.durationDays - b.durationDays) }));
          }}
        />
      )}
      <ErrorBanner message={error ?? actionError} />
      {loading && !data ? (
        <Loading />
      ) : plans.length === 0 ? (
        <Empty>No plans yet.{admin ? ' Create your first plan so members can pay in the app.' : ''}</Empty>
      ) : (
        <div className="plan-grid">
          {plans.map((p, i) => (
            <article key={p.id} className="card plan-card lift" data-testid="plan-card" style={stagger(i)}>
              <div className="plan-name">{p.name}</div>
              <div className="plan-price">{formatInr(p.pricePaise)}</div>
              <div className="muted small">{p.durationDays} days</div>
              {p.benefits.length > 0 && (
                <ul className="plan-benefits">
                  {p.benefits.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {admin && (
                <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => archive(p)}>
                  Archive
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      </>
    );
  }
}
