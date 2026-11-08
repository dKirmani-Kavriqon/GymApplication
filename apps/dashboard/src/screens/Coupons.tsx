import { useState, type FormEvent } from 'react';
import { couponSchema, dayKey, formatInr, type Coupon, type Gym, type Plan } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDate, rupeesToPaise } from '../lib/format';
import { emptyToNull, numOrNull, validate } from '../lib/validate';
import { stagger } from '../lib/motion';
import { Icon } from '../components/Icon';
import { Chip, Empty, ErrorBanner, Loading } from '../components/ui';
import { useToast } from '../components/Toast';

export function discountLabel(c: Pick<Coupon, 'kind' | 'amount'>): string {
  return c.kind === 'percent' ? `${c.amount}% off` : `${formatInr(c.amount)} off`;
}

function CouponForm({ gym, plans, onCreated, onCancel }: { gym: Gym; plans: Plan[]; onCreated: (c: Coupon) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'flat'>('percent');
  const [amount, setAmount] = useState('');
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [expiresOn, setExpiresOn] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    let value: number | null;
    if (kind === 'flat') {
      value = amount.trim() ? rupeesToPaise(amount) : null;
      if (value === null) {
        setError('Enter the discount in rupees, like 500');
        return;
      }
    } else {
      value = numOrNull(amount);
    }
    const parsed = validate(couponSchema, {
      code,
      kind,
      amount: value,
      planIds,
      expiresOn: emptyToNull(expiresOn),
      maxUses: numOrNull(maxUses),
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<Coupon>(`/gyms/${gym.id}/coupons`, parsed.data));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label="New coupon">
      <h2>New coupon</h2>
      <div className="form-grid">
        <label className="field span-2">
          <span>Code</span>
          <input className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} placeholder="DIWALI20" />
        </label>
        <div className="field span-2">
          <span className="field-label">Discount type</span>
          <div className="segmented" role="radiogroup" aria-label="Discount type">
            {(['percent', 'flat'] as const).map((k) => (
              <label key={k} className={kind === k ? 'is-active' : ''}>
                <input type="radio" name="coupon-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                {k === 'percent' ? 'Percent' : 'Flat amount (₹)'}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{kind === 'percent' ? 'Discount (%)' : 'Discount (₹)'}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === 'percent' ? '20' : '500'} />
        </label>
        <label className="field">
          <span>Expires on</span>
          <input type="date" value={expiresOn} min={dayKey(new Date(), gym.timezone)} onChange={(e) => setExpiresOn(e.target.value)} />
        </label>
        <label className="field">
          <span>Max uses</span>
          <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" />
        </label>
        <fieldset className="field span-4 plan-picks">
          <legend className="field-label">Plans</legend>
          <small className="muted">Leave all unticked to allow every plan.</small>
          <div className="chip-row">
            {plans.map((p) => (
              <label key={p.id} className="check-chip">
                <input
                  type="checkbox"
                  checked={planIds.includes(p.id)}
                  onChange={(e) => setPlanIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Create coupon'}
        </button>
      </div>
    </form>
  );
}

export function Coupons({ gym, plans }: { gym: Gym; plans: Plan[] }) {
  const { data, error, loading, setData } = useApiData<{ coupons: Coupon[] }>(`/gyms/${gym.id}/coupons`);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const coupons = data?.coupons ?? [];
  const today = dayKey(new Date(), gym.timezone);
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? 'Archived plan';

  async function setActive(c: Coupon, active: boolean) {
    setActionError(null);
    setData((d) => d && { coupons: d.coupons.map((x) => (x.id === c.id ? { ...x, active } : x)) });
    try {
      const updated = await api.patch<Coupon>(`/gyms/${gym.id}/coupons/${c.id}`, { active });
      setData((d) => d && { coupons: d.coupons.map((x) => (x.id === c.id ? { ...x, ...updated } : x)) });
      toast(`${c.code} ${active ? 'activated' : 'paused'}`);
    } catch (err) {
      setData((d) => d && { coupons: d.coupons.map((x) => (x.id === c.id ? { ...x, active: c.active } : x)) });
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <div className="section-head">
        <p className="muted small">Members enter a code at checkout. Discounts apply to the plan price.</p>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> New coupon
          </button>
        )}
      </div>
      {adding && (
        <CouponForm
          gym={gym}
          plans={plans}
          onCancel={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false);
            toast(`Coupon ${c.code} created`);
            setData((d) => ({ coupons: [c, ...(d?.coupons ?? [])] }));
          }}
        />
      )}
      <ErrorBanner message={error ?? actionError} />
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : coupons.length === 0 ? (
          <Empty icon="tag">No coupons yet. A festive discount is a good start.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Plans</th>
                  <th>Expires</th>
                  <th className="num">Uses</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c, i) => {
                  const expired = !!c.expiresOn && c.expiresOn < today;
                  const usedUp = c.maxUses !== null && c.uses >= c.maxUses;
                  return (
                    <tr key={c.id} data-testid="coupon-row" className="row-in" style={stagger(i)}>
                      <td>
                        <span className="mono coupon-code">{c.code}</span>
                      </td>
                      <td>{discountLabel(c)}</td>
                      <td className="small">{c.planIds.length === 0 ? 'All plans' : c.planIds.map(planName).join(', ')}</td>
                      <td className="small">
                        {c.expiresOn ? formatDate(`${c.expiresOn}T12:00:00Z`, 'UTC') : 'No expiry'}{' '}
                        {expired && <Chip tone="danger">Expired</Chip>}
                      </td>
                      <td className="num">
                        {c.uses} / {c.maxUses ?? '∞'} {usedUp && <Chip tone="warning">Used up</Chip>}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="toggle"
                          aria-label={`${c.code} active`}
                          checked={c.active}
                          onChange={(e) => setActive(c, e.target.checked)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
