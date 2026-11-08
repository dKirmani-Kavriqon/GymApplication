import { useState, type FormEvent } from 'react';
import type { Announcement, Gym, Role } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDateTime } from '../lib/format';
import { isAdmin } from '../lib/roles';
import { Empty, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';

export function sortAnnouncements(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

export function Announcements({ gym, role }: { gym: Gym; role: Role }) {
  const { data, error, loading, setData } = useApiData<{ announcements: Announcement[] }>(`/gyms/${gym.id}/announcements`);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();
  const admin = isAdmin(role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await api.post<Announcement>(`/gyms/${gym.id}/announcements`, { title: title.trim(), body: body.trim(), pinned });
      setData((d) => ({ announcements: sortAnnouncements([created, ...(d?.announcements ?? [])]) }));
      setTitle('');
      setBody('');
      setPinned(false);
      toast('Announcement posted');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const list = data?.announcements ?? [];
  return (
    <div className="stack-lg">
      <PageHeader title="Announcements" subtitle="Shown on members' home screen; pinned posts stay on top." />
      {!gym.enabledFeatures.includes('announcements') && (
        <div className="info-banner">Announcements are switched off for members. Turn them on in Branding → Features.</div>
      )}
      {admin && (
        <form className="card stack" onSubmit={submit} aria-label="New announcement">
          <h2>New announcement</h2>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} placeholder="Diwali timings" />
          </label>
          <label className="field">
            <span>Message</span>
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={1000}
              placeholder="We're open 6am–12pm on Nov 1."
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top
          </label>
          <ErrorBanner message={formError} />
          <div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Posting…' : 'Post announcement'}
            </button>
          </div>
        </form>
      )}
      <ErrorBanner message={error} />
      {loading && !data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>No announcements yet.</Empty>
      ) : (
        <ul className="announcement-list">
          {list.map((a) => (
            <li key={a.id} className="card announcement" data-testid="announcement">
              <div className="section-head">
                <h3>
                  {a.title} {a.pinned && <span className="badge badge-brand"><Icon name="pin" size={12} /> Pinned</span>}
                </h3>
                <span className="muted small">{formatDateTime(a.createdAt, gym.timezone)}</span>
              </div>
              <p className="pre-wrap">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
