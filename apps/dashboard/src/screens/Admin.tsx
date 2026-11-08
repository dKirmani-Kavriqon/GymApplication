import { useEffect, useState } from 'react';
import { formatInr, type AdminGymRow, type AdminStats } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDate } from '../lib/format';
import { stagger } from '../lib/motion';
import { Chip, CountUp, Empty, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';

const TIERS: AdminGymRow['planTier'][] = ['starter', 'pro', 'enterprise'];
const TIER_LABEL: Record<AdminGymRow['planTier'], string> = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };
export const WEEKLY_ACTIVE_GOAL = 45;

/** AdminStats.weeklyActiveRate (a 0–1 fraction) as a percentage, clamped to 0–100. */
export function ratePercent(rate: number): number {
  const fraction = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
  return Math.round(fraction * 1000) / 10;
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function StatTiles({ stats }: { stats: AdminStats }) {
  const pct = ratePercent(stats.weeklyActiveRate);
  const onTrack = pct >= WEEKLY_ACTIVE_GOAL;
  const tiles: Array<{ label: string; value: number; format?: (n: number) => string; sub?: string; id: string }> = [
    { id: 'gyms', label: 'Gyms', value: stats.gyms, sub: `${stats.suspendedGyms} suspended` },
    { id: 'users', label: 'Users', value: stats.users },
    { id: 'members', label: 'Members', value: stats.members },
    { id: 'checkins-today', label: 'Check-ins today', value: stats.checkInsToday },
    { id: 'checkins-30d', label: 'Check-ins (30d)', value: stats.checkIns30d },
    { id: 'revenue-30d', label: 'Revenue (30d)', value: stats.revenue30dPaise, format: (n) => formatInr(Math.round(n / 100) * 100) },
  ];
  return (
    <div className="stack">
      <section className={`card weekly-goal rise${onTrack ? ' is-on-track' : ''}`} style={stagger(0)} aria-label="Weekly active rate">
        <div className="section-head">
          <div>
            <span className="stat-label">Weekly active members</span>
            <div className="stat-value" data-testid="admin-weekly-rate">
              <CountUp value={pct} format={(n) => `${Math.round(n)}%`} />
            </div>
          </div>
          <Chip tone={onTrack ? 'success' : 'warning'}>{onTrack ? 'On track' : `Below the ${WEEKLY_ACTIVE_GOAL}% goal`}</Chip>
        </div>
        <div
          className="goal-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`Weekly active rate ${pct}% against a ${WEEKLY_ACTIVE_GOAL}% goal`}
        >
          <b style={{ width: `${Math.min(100, pct)}%` }} />
          <i style={{ left: `${WEEKLY_ACTIVE_GOAL}%` }} aria-hidden>
            <span>Goal {WEEKLY_ACTIVE_GOAL}%</span>
          </i>
        </div>
      </section>
      <div className="stat-grid stat-grid-6">
        {tiles.map((t, i) => (
          <div key={t.id} className="card stat rise" style={stagger(i + 1)}>
            <span className="stat-label">{t.label}</span>
            <span className="stat-value" data-testid={`admin-${t.id}`}>
              <CountUp value={t.value} format={t.format} />
            </span>
            {t.sub && <span className="muted small">{t.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function GymRow({ row, onChange }: { row: AdminGymRow; onChange: (r: AdminGymRow) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function update(patch: { planTier?: AdminGymRow['planTier']; suspended?: boolean }, message: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.patch<AdminGymRow>(`/admin/gyms/${row.id}`, patch);
      onChange({ ...row, ...patch, ...next });
      setConfirming(false);
      toast(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr data-testid="admin-gym-row" className={row.suspended ? 'is-suspended' : undefined}>
        <td>
          <strong>{row.name}</strong>
          <div className="muted small">
            {row.city} · <span className="mono">{row.joinCode}</span> · since {formatDate(row.createdAt)}
          </div>
          {row.owners.length > 0 && <div className="muted small">Owner: {row.owners.map((o) => o.name ?? 'Unnamed').join(', ')}</div>}
        </td>
        <td className="num">{row.members}</td>
        <td className="num">{row.activeMembers30d}</td>
        <td className="num">{row.checkIns30d}</td>
        <td className="num">{formatInr(row.revenue30dPaise)}</td>
        <td>
          <select
            aria-label={`Plan tier for ${row.name}`}
            value={row.planTier}
            disabled={busy}
            onChange={(e) => update({ planTier: e.target.value as AdminGymRow['planTier'] }, `${row.name} moved to ${TIER_LABEL[e.target.value as AdminGymRow['planTier']]}`)}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </td>
        <td className="actions">
          {row.suspended && <Chip tone="danger">Suspended</Chip>}{' '}
          <button
            type="button"
            className={`btn btn-small ${row.suspended ? 'btn-secondary' : 'btn-danger-ghost'}`}
            onClick={() => setConfirming(true)}
            disabled={busy || confirming}
          >
            {row.suspended ? 'Unsuspend' : 'Suspend'}
          </button>
        </td>
      </tr>
      {(confirming || error) && (
        <tr className="confirm-row">
          <td colSpan={7}>
            {confirming && (
              <div className="confirm-panel" role="group" aria-label={`${row.suspended ? 'Unsuspend' : 'Suspend'} ${row.name}?`}>
                <div>
                  <strong>
                    {row.suspended ? 'Unsuspend' : 'Suspend'} {row.name}?
                  </strong>
                  <p className="small">
                    {row.suspended
                      ? 'Members and staff get access again straight away.'
                      : 'Members and staff lose access to this gym until you unsuspend it. Owners can still see the gym and are told to contact GymVerse.'}
                  </p>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirming(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`btn btn-small ${row.suspended ? 'btn-primary' : 'btn-danger'}`}
                    disabled={busy}
                    onClick={() => update({ suspended: !row.suspended }, row.suspended ? `${row.name} is active again` : `${row.name} suspended`)}
                  >
                    {busy ? 'Saving…' : row.suspended ? 'Yes, unsuspend' : 'Yes, suspend'}
                  </button>
                </div>
              </div>
            )}
            <ErrorBanner message={error} />
          </td>
        </tr>
      )}
    </>
  );
}

export function Admin({ onGymChanged }: { onGymChanged?: (row: AdminGymRow) => void }) {
  const stats = useApiData<AdminStats>('/admin/stats');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const gyms = useApiData<{ gyms: AdminGymRow[] }>(`/admin/gyms${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const list = gyms.data?.gyms ?? [];

  return (
    <div className="stack-lg">
      <PageHeader eyebrow="GymVerse platform" title="Admin" subtitle="Every gym on GymVerse: health, plan tier and access." />
      <ErrorBanner message={stats.error} />
      {stats.loading && !stats.data ? <Loading rows={3} /> : stats.data ? <StatTiles stats={stats.data} /> : null}
      <section className="card">
        <div className="toolbar">
          <h2>Gyms</h2>
          <input
            type="search"
            className="search"
            placeholder="Search by name, city or code"
            aria-label="Search gyms"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ErrorBanner message={gyms.error} />
        {gyms.loading && !gyms.data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="search">{query ? `No gyms match “${query}”.` : 'No gyms yet.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Gyms">
              <thead>
                <tr>
                  <th>Gym</th>
                  <th className="num">Members</th>
                  <th className="num">Active 30d</th>
                  <th className="num">Check-ins 30d</th>
                  <th className="num">Revenue 30d</th>
                  <th>Tier</th>
                  <th aria-label="Access" />
                </tr>
              </thead>
              <tbody>
                {list.map((g) => (
                  <GymRow
                    key={g.id}
                    row={g}
                    onChange={(next) => {
                      gyms.setData((d) => d && { gyms: d.gyms.map((x) => (x.id === next.id ? next : x)) });
                      void stats.reload();
                      onGymChanged?.(next);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
