import { useState, type FormEvent } from 'react';
import { freezeDecisionSchema, type FreezeRequest, type Gym } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDate, pluralize } from '../lib/format';
import { emptyToNull, validate } from '../lib/validate';
import { stagger } from '../lib/motion';
import { Chip, Empty, ErrorBanner, Loading, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

type Status = FreezeRequest['status'];

const STATUS_LABEL: Record<Status, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'muted' } as const;
const day = (d: string) => formatDate(`${d}T12:00:00Z`, 'UTC');

function Decision({
  gym,
  request,
  status,
  onDone,
  onCancel,
}: {
  gym: Gym;
  request: FreezeRequest;
  status: 'approved' | 'rejected';
  onDone: (r: FreezeRequest) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = status === 'approved';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(freezeDecisionSchema, { status, note: emptyToNull(note) });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api.patch<FreezeRequest>(`/gyms/${gym.id}/freeze-requests/${request.id}`, { status, note: parsed.data.note ?? null }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="decision" onSubmit={submit} noValidate aria-label={approve ? 'Approve pause' : 'Reject pause'}>
      <p className="small">
        {approve
          ? `Approving adds ${pluralize(request.days, 'day')} to ${request.member.name ?? 'the member'}'s membership.`
          : `${request.member.name ?? 'The member'} will be told the pause wasn't approved.`}
      </p>
      <label className="field">
        <span>Note to the member (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={approve ? 'Enjoy your trip!' : 'Pauses need 7 days notice.'} />
      </label>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={`btn btn-small ${approve ? 'btn-primary' : 'btn-danger'}`} disabled={busy}>
          {busy ? 'Saving…' : approve ? 'Confirm approval' : 'Confirm rejection'}
        </button>
      </div>
    </form>
  );
}

export function FreezeRequests({ gym, onChanged }: { gym: Gym; onChanged?: () => void }) {
  const [status, setStatus] = useState<Status | 'all'>('pending');
  const path = `/gyms/${gym.id}/freeze-requests${status === 'all' ? '' : `?status=${status}`}`;
  const { data, error, loading, setData } = useApiData<{ requests: FreezeRequest[] }>(path);
  const [deciding, setDeciding] = useState<{ id: string; status: 'approved' | 'rejected' } | null>(null);
  const toast = useToast();
  const list = data?.requests ?? [];

  return (
    <div className="stack">
      <Tabs
        sub
        label="Pause request status"
        value={status}
        onChange={(s) => {
          setStatus(s);
          setDeciding(null);
        }}
        tabs={[
          { id: 'pending', label: 'Pending' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
          { id: 'all', label: 'All' },
        ]}
      />
      <ErrorBanner message={error} />
      {loading && !data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon="pause">{status === 'pending' ? 'No pause requests waiting.' : 'Nothing here yet.'}</Empty>
      ) : (
        <ul className="plain-list stack-sm">
          {list.map((r, i) => {
            return (
              <li key={r.id} className="card freeze-item rise" style={stagger(i)} data-testid="freeze-request">
                <div className="section-head">
                  <div>
                    <strong>{r.member.name ?? 'Member'}</strong>
                    <div className="muted small">
                      {day(r.startsOn)} – {day(r.endsOn)} · <strong className="freeze-days">{pluralize(r.days, 'day')}</strong> · asked{' '}
                      {formatDate(r.createdAt, gym.timezone)}
                    </div>
                  </div>
                  <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                </div>
                <p className="small pre-wrap">“{r.reason}”</p>
                {r.newEndsAt && r.status === 'approved' && <p className="small success-text">Membership now ends {formatDate(r.newEndsAt, gym.timezone)}</p>}
                {r.newEndsAt && r.status === 'pending' && <p className="small muted">If approved, membership ends {formatDate(r.newEndsAt, gym.timezone)}</p>}
                {r.note && <p className="small muted">Note: {r.note}</p>}
                {r.status === 'pending' &&
                  (deciding?.id === r.id ? (
                    <Decision
                      gym={gym}
                      request={r}
                      status={deciding.status}
                      onCancel={() => setDeciding(null)}
                      onDone={(updated) => {
                        setDeciding(null);
                        setData((d) => d && { requests: d.requests.map((x) => (x.id === r.id ? { ...x, ...updated } : x)) });
                        toast(updated.status === 'approved' ? `Pause approved for ${r.member.name ?? 'member'}` : 'Pause request rejected');
                        onChanged?.();
                      }}
                    />
                  ) : (
                    <div className="card-actions">
                      <button type="button" className="btn btn-small btn-primary" onClick={() => setDeciding({ id: r.id, status: 'approved' })}>
                        Approve
                      </button>
                      <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => setDeciding({ id: r.id, status: 'rejected' })}>
                        Reject
                      </button>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
