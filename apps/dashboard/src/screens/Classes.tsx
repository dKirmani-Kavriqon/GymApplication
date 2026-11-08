import { useState, type FormEvent } from 'react';
import { addDays, dayKey, type Attendee, type ClassSession, type Gym } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDateTime, zonedLocalToIso } from '../lib/format';
import { Empty, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';

function Attendees({ gym, session }: { gym: Gym; session: ClassSession }) {
  const { data, error, loading, setData } = useApiData<{ attendees: Attendee[] }>(`/gyms/${gym.id}/classes/${session.id}/attendees`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading && !data) return <Loading rows={2} />;
  if (error) return <ErrorBanner message={error} />;
  const list = data?.attendees ?? [];
  if (list.length === 0) return <p className="muted small">No bookings yet.</p>;
  const booked = list.filter((a) => a.status === 'booked');
  const here = booked.filter((a) => a.attended === true).length;

  async function mark(a: Attendee, attended: boolean) {
    setBusy(a.userId);
    setActionError(null);
    const patch = (value: boolean | null) =>
      setData((d) => d && { attendees: d.attendees.map((x) => (x.userId === a.userId ? { ...x, attended: value } : x)) });
    patch(attended);
    try {
      const updated = await api.put<Attendee>(`/gyms/${gym.id}/classes/${session.id}/attendees/${a.userId}`, { attended });
      patch(updated?.attended ?? attended);
    } catch (err) {
      patch(a.attended ?? null);
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-sm">
      <div className="attendance-head">
        <strong data-testid="attendance-count">
          {here} of {booked.length} here
        </strong>
        <span className="attendance-meter" aria-hidden>
          <b style={{ width: `${booked.length ? (here / booked.length) * 100 : 0}%` }} />
        </span>
      </div>
      <ErrorBanner message={actionError} />
      <ul className="attendee-list" aria-label={`Attendees for ${session.title}`}>
        {list.map((a) => {
          const name = a.name ?? 'Unnamed';
          return (
            <li key={a.userId}>
              <span>{name}</span>
              <span className="mono small muted">{a.phone}</span>
              {a.status === 'booked' ? (
                <button
                  type="button"
                  className={`attend-btn${a.attended === true ? ' is-present' : a.attended === false ? ' is-absent' : ''}`}
                  aria-pressed={a.attended === true}
                  aria-label={`${name} attended`}
                  disabled={busy === a.userId}
                  onClick={() => mark(a, a.attended !== true)}
                >
                  <Icon name={a.attended === true ? 'check' : a.attended === false ? 'x' : 'user'} size={14} />
                  {a.attended === true ? 'Present' : a.attended === false ? 'Absent' : 'Mark present'}
                </button>
              ) : (
                <span className="badge badge-expiring">{a.status}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CreateClassForm({ gym, onCreated }: { gym: Gym; onCreated: (c: ClassSession) => void }) {
  const tomorrow = addDays(dayKey(new Date(), gym.timezone), 1);
  const [title, setTitle] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState('07:00');
  const [durationMin, setDurationMin] = useState('60');
  const [capacity, setCapacity] = useState('20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let startsAt: string;
    try {
      startsAt = zonedLocalToIso(date, time, gym.timezone);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<ClassSession>(`/gyms/${gym.id}/classes`, {
        title: title.trim(),
        trainerName: trainerName.trim() || null,
        startsAt,
        durationMin: Number(durationMin),
        capacity: Number(capacity),
      });
      setTitle('');
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-label="Create class">
      <h2>New class</h2>
      <div className="form-grid">
        <label className="field span-2">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning HIIT" required minLength={2} maxLength={60} />
        </label>
        <label className="field span-2">
          <span>Trainer</span>
          <input value={trainerName} onChange={(e) => setTrainerName(e.target.value)} placeholder="Coach Vikram" maxLength={60} />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>Start time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="field">
          <span>Duration (min)</span>
          <input type="number" min={10} max={240} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} required />
        </label>
        <label className="field">
          <span>Capacity</span>
          <input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        </label>
      </div>
      <small className="muted">Times are in the gym's time zone ({gym.timezone}).</small>
      <ErrorBanner message={error} />
      <div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create class'}
        </button>
      </div>
    </form>
  );
}

export function Classes({ gym }: { gym: Gym }) {
  const { data, error, loading, setData, reload } = useApiData<{ classes: ClassSession[] }>(`/gyms/${gym.id}/classes?days=30`);
  const [open, setOpen] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const classes = data?.classes ?? [];

  async function remove(c: ClassSession) {
    if (!window.confirm(`Delete "${c.title}" on ${formatDateTime(c.startsAt, gym.timezone)}? Bookings will be cancelled.`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/classes/${c.id}`);
      setData((d) => d && { classes: d.classes.filter((x) => x.id !== c.id) });
      toast('Class deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Classes"
        subtitle="Upcoming sessions for the next 30 days"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : 'New class'}
          </button>
        }
      />
      {!gym.enabledFeatures.includes('classes') && (
        <div className="info-banner">Classes are switched off for members. Turn them on in Branding → Features.</div>
      )}
      {showForm && (
        <CreateClassForm
          gym={gym}
          onCreated={(c) => {
            toast('Class created');
            setShowForm(false);
            setData((d) => ({ classes: [...(d?.classes ?? []), c].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) }));
            void reload();
          }}
        />
      )}
      <ErrorBanner message={error ?? actionError} />
      <section className="card">
        {loading && !data ? (
          <Loading />
        ) : classes.length === 0 ? (
          <Empty>No upcoming classes. Create one to get members booking.</Empty>
        ) : (
          <ul className="class-list">
            {classes.map((c) => {
              const full = c.bookedCount >= c.capacity;
              return (
                <li key={c.id} className="class-item" data-testid="class-row">
                  <div className="class-main">
                    <div className="class-when">{formatDateTime(c.startsAt, gym.timezone)}</div>
                    <div className="class-title">
                      <strong>{c.title}</strong>
                      <span className="muted small">
                        {c.trainerName ? ` · ${c.trainerName}` : ''} · {c.durationMin} min
                      </span>
                    </div>
                  </div>
                  <div className="class-stats">
                    <span className={`badge ${full ? 'badge-expiring' : 'badge-active'}`}>
                      {c.bookedCount}/{c.capacity} booked
                    </span>
                    {c.waitlistCount > 0 && <span className="badge badge-none">{c.waitlistCount} waitlisted</span>}
                  </div>
                  <div className="class-actions">
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      {open === c.id ? 'Hide attendees' : 'Attendees'}
                    </button>
                    <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(c)}>
                      Delete
                    </button>
                  </div>
                  {open === c.id && (
                    <div className="class-attendees">
                      <Attendees gym={gym} session={c} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
