import { useMemo, useState, type ChangeEvent } from 'react';
import { ROLES, dayKey, type Gym, type MemberRow, type Role } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { parseMemberCsv } from '../lib/csv';
import { lastVisitLabel, membershipLabel, pluralize } from '../lib/format';
import { ROLE_LABELS, isAdmin, isOwner } from '../lib/roles';
import { Empty, ErrorBanner, Loading, Modal, PageHeader, Tabs } from '../components/ui';
import { FreezeRequests } from './FreezeRequests';
import { Icon } from '../components/Icon';
import { MemberWorkouts } from './MemberWorkouts';
import { useToast } from '../components/Toast';

interface ImportResult {
  created: number;
  added: number;
  skipped: number;
}

/** Blob.text() with a FileReader fallback for older browsers. */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function filterMembers(members: MemberRow[], query: string): MemberRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;
  const digits = q.replace(/\D/g, '');
  return members.filter(
    (m) => (m.name ?? '').toLowerCase().includes(q) || (digits.length >= 2 && m.phone.replace(/\D/g, '').includes(digits)),
  );
}

function CsvImport({ gym, onImported }: { gym: Gym; onImported: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const parsed = useMemo(() => parseMemberCsv(text), [text]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setText(await readFileText(file));
      setResult(null);
    } catch {
      setError('Could not read that file.');
    }
  }

  async function submit() {
    if (parsed.rows.length === 0) {
      setError('Add at least one row with a phone number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>(`/gyms/${gym.id}/members/import`, { rows: parsed.rows });
      setResult(res);
      setText('');
      onImported();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-label="Import members">
      <div className="section-head">
        <h2>Import members</h2>
        <label className="btn btn-small file-btn">
          Upload CSV
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} aria-label="CSV file" />
        </label>
      </div>
      <p className="muted small">
        One member per line as <code>phone,name</code>. A header row is optional. 10-digit numbers get +91.
      </p>
      <textarea
        aria-label="CSV rows"
        rows={5}
        className="mono"
        placeholder={'phone,name\n9876543210,Asha Verma\n+919812345678,"Rao, Kiran"'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
      />
      {text.trim() && (
        <div className="small" data-testid="csv-preview">
          <strong>{pluralize(parsed.rows.length, 'row')} ready</strong>
          {parsed.hasHeader && <span className="muted"> · header detected</span>}
          {parsed.issues.length > 0 && (
            <ul className="issue-list">
              {parsed.issues.slice(0, 8).map((i) => (
                <li key={`${i.line}-${i.message}`}>
                  {i.line > 0 ? `Line ${i.line}: ` : ''}
                  {i.message}
                </li>
              ))}
              {parsed.issues.length > 8 && <li>…and {parsed.issues.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}
      <ErrorBanner message={error} />
      {result && (
        <div className="success-banner" data-testid="import-result">
          Import done: {result.created} new accounts created, {result.added} added to the gym, {result.skipped} skipped (already members).
        </div>
      )}
      <div>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || parsed.rows.length === 0}>
          {busy ? 'Importing…' : `Import ${pluralize(parsed.rows.length, 'member')}`}
        </button>
      </div>
    </section>
  );
}

export function Members({
  gym,
  role,
  myUserId,
  showWorkouts = false,
  pendingFreezes = 0,
  onFreezesChanged,
}: {
  gym: Gym;
  role: Role;
  myUserId: string;
  showWorkouts?: boolean;
  /** Pending pause (freeze) requests, for the tab badge. */
  pendingFreezes?: number;
  onFreezesChanged?: () => void;
}) {
  const [tab, setTab] = useState<'members' | 'pause'>('members');
  const { data, error, loading, reload, setData } = useApiData<{ members: MemberRow[] }>(`/gyms/${gym.id}/members`);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [workoutsFor, setWorkoutsFor] = useState<MemberRow | null>(null);
  const toast = useToast();
  const today = dayKey(new Date(), gym.timezone);
  const members = data?.members ?? [];
  const visible = filterMembers(members, query);
  const admin = isAdmin(role);
  const owner = isOwner(role);
  const hasActions = admin || showWorkouts;

  async function changeRole(m: MemberRow, next: Role) {
    setActionError(null);
    try {
      await api.patch(`/gyms/${gym.id}/members/${m.userId}`, { role: next });
      setData((d) => d && { members: d.members.map((x) => (x.userId === m.userId ? { ...x, role: next } : x)) });
      toast(`${m.name ?? m.phone} is now ${ROLE_LABELS[next].toLowerCase()}`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function deactivate(m: MemberRow) {
    if (!window.confirm(`Deactivate ${m.name ?? m.phone}? They will lose access to ${gym.branding.gymName}.`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/members/${m.userId}`);
      setData((d) => d && { members: d.members.filter((x) => x.userId !== m.userId) });
      toast(`${m.name ?? m.phone} deactivated`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Members"
        subtitle={data ? `${pluralize(members.length, 'person', 'people')} · ${members.filter((m) => m.atRisk).length} at risk` : undefined}
        actions={
          admin &&
          tab === 'members' && (
            <button type="button" className="btn btn-secondary" onClick={() => setShowImport((s) => !s)}>
              {showImport ? 'Close import' : 'Import CSV'}
            </button>
          )
        }
      />
      {admin && (
        <Tabs
          label="Members and pause requests"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'members', label: 'Members' },
            { id: 'pause', label: 'Pause requests', count: pendingFreezes > 0 ? pendingFreezes : undefined },
          ]}
        />
      )}
      {tab === 'pause' && admin ? (
        <FreezeRequests gym={gym} onChanged={onFreezesChanged} />
      ) : (
      <>
      {admin && showImport && <CsvImport gym={gym} onImported={reload} />}
      <ErrorBanner message={error ?? actionError} />
      <section className="card">
        <div className="toolbar">
          <input
            type="search"
            className="search"
            placeholder="Search by name or phone"
            aria-label="Search members"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <span className="muted small">{pluralize(visible.length, 'match', 'matches')}</span>}
        </div>
        {loading && !data ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty>{members.length === 0 ? 'No members yet. Share your join QR or import a CSV.' : 'No members match your search.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Last visit</th>
                  <th className="num">Check-ins</th>
                  <th>Membership</th>
                  {hasActions && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.userId} data-testid="member-row">
                    <td>
                      <span className="member-name">{m.name ?? 'Unnamed'}</span>
                      {m.atRisk && (
                        <span className="badge badge-danger" title="No visit in 14+ days">
                          At risk
                        </span>
                      )}
                    </td>
                    <td className="mono small">{m.phone}</td>
                    <td>
                      {owner && m.userId !== myUserId ? (
                        <select
                          aria-label={`Role for ${m.name ?? m.phone}`}
                          value={m.role}
                          onChange={(e) => changeRole(m, e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`badge badge-role-${m.role}`}>{ROLE_LABELS[m.role]}</span>
                      )}
                    </td>
                    <td>{lastVisitLabel(m.lastVisit, today)}</td>
                    <td className="num">{m.totalCheckIns}</td>
                    <td>
                      <span className={`badge badge-${m.membership.state}`}>{membershipLabel(m.membership)}</span>
                    </td>
                    {hasActions && (
                      <td className="actions">
                        {showWorkouts && (
                          <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            aria-label={`Workouts for ${m.name ?? m.phone}`}
                            onClick={() => setWorkoutsFor(m)}
                          >
                            <Icon name="dumbbell" size={16} /> Workouts
                          </button>
                        )}
                        {admin && m.role !== 'owner' && m.userId !== myUserId && (
                          <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => deactivate(m)}>
                            Deactivate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {workoutsFor && (
        <Modal title={`Workouts · ${workoutsFor.name ?? workoutsFor.phone}`} onClose={() => setWorkoutsFor(null)} wide>
          <MemberWorkouts gym={gym} member={workoutsFor} />
        </Modal>
      )}
      </>
      )}
    </div>
  );
}
