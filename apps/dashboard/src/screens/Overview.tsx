import { dayKey, formatInr, type AttendanceReport, type Gym, type MemberRow, type RevenueReport } from '@gymverse/shared';
import { useApiData } from '../lib/useApi';
import { hourLabel, lastVisitLabel, shortDayLabel } from '../lib/format';
import { BarChart } from '../components/BarChart';
import { CountUp, Empty, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { stagger } from '../lib/motion';
import { inr, monthChange } from './Revenue';
import { NudgeButton } from '../components/NudgeButton';

export function Overview({ gym, showRevenue = false, onOpenRevenue }: { gym: Gym; showRevenue?: boolean; onOpenRevenue?: () => void }) {
  const report = useApiData<AttendanceReport>(`/gyms/${gym.id}/reports/attendance`);
  const members = useApiData<{ members: MemberRow[] }>(`/gyms/${gym.id}/members`);
  // Admins get a revenue tile; errors are ignored here (the Revenue page shows them).
  const revenue = useApiData<RevenueReport>(showRevenue ? `/gyms/${gym.id}/reports/revenue` : null);
  const today = dayKey(new Date(), gym.timezone);
  const atRisk = (members.data?.members ?? []).filter((m) => m.atRisk);
  const r = report.data;
  const peak = r ? r.peakHours.reduce((best, h) => (h.count > best.count ? h : best), r.peakHours[0]) : null;
  // Peak hours: show gym hours 5am–11pm unless there are check-ins outside them.
  const hours = r ? r.peakHours.filter((h) => (h.hour >= 5 && h.hour <= 23) || h.count > 0) : [];


  return (
    <div className="stack-lg">
      <PageHeader eyebrow="Dashboard" title="Overview" subtitle={`${gym.branding.gymName} · ${gym.city}`} />
      <ErrorBanner message={report.error ?? members.error} />
      {report.loading && !r ? (
        <Loading />
      ) : r ? (
        <>
          <div className="stat-grid">
            <div className="card stat stat-hero rise" style={stagger(0)}>
              <span className="stat-label">Check-ins today</span>
              <span className="stat-value" data-testid="stat-today">
                <CountUp value={r.today} />
              </span>
            </div>
            <div className="card stat rise" style={stagger(1)}>
              <span className="stat-label">Active members (30d)</span>
              <span className="stat-value" data-testid="stat-active">
                <CountUp value={r.activeMembers} />
                <span className="stat-total"> / {r.totalMembers}</span>
              </span>
            </div>
            <div className="card stat rise" style={stagger(2)}>
              <span className="stat-label">Members at risk</span>
              <span className="stat-value" data-testid="stat-risk">
                {members.data ? <CountUp value={atRisk.length} /> : '–'}
              </span>
            </div>
            <div className="card stat rise" style={stagger(3)}>
              <span className="stat-label">Busiest hour (30d)</span>
              <span className="stat-value">{peak && peak.count > 0 ? hourLabel(peak.hour) : '–'}</span>
            </div>
          </div>
          {showRevenue && revenue.data && (
            <section className="card revenue-tile rise" style={stagger(4)} aria-label="Revenue this month" data-testid="revenue-tile">
              <div>
                <span className="stat-label">Collected this month</span>
                <span className="stat-value">
                  <CountUp value={revenue.data.collectedThisMonthPaise} format={inr} />
                </span>
                <span className={`trend trend-${monthChange(revenue.data.collectedThisMonthPaise, revenue.data.collectedLastMonthPaise).tone}`}>
                  {monthChange(revenue.data.collectedThisMonthPaise, revenue.data.collectedLastMonthPaise).text}
                </span>
              </div>
              <div className="revenue-tile-side">
                <span className="small muted">
                  {revenue.data.renewalsDue.length} renewal{revenue.data.renewalsDue.length === 1 ? '' : 's'} due this week ·{' '}
                  {revenue.data.unpaidMembers} without a plan
                </span>
                {onOpenRevenue && (
                  <button type="button" className="btn btn-small btn-secondary" onClick={onOpenRevenue}>
                    Open revenue
                  </button>
                )}
              </div>
            </section>
          )}
          <div className="two-col-wide">
            <section className="card">
              <h2>Check-ins · last 14 days</h2>
              <BarChart
                title="Check-ins in the last 14 days"
                bars={r.days.map((d, i) => ({
                  key: d.day,
                  label: shortDayLabel(d.day),
                  value: d.count,
                  showLabel: i % 2 === r.days.length % 2 || d.day === today,
                  highlight: d.day === today,
                }))}
              />
            </section>
            <section className="card">
              <h2>Peak hours · last 30 days</h2>
              <BarChart
                title="Check-ins by hour of day"
                bars={hours.map((h) => ({
                  key: String(h.hour),
                  label: hourLabel(h.hour),
                  value: h.count,
                  showLabel: h.hour % 3 === 0,
                  highlight: peak !== null && h.hour === peak.hour && h.count > 0,
                }))}
              />
            </section>
          </div>
        </>
      ) : null}

      <section className="card">
        <div className="section-head">
          <h2>Members at risk</h2>
          <span className="muted small">No visit in 14+ days</span>
        </div>
        {members.loading && !members.data ? (
          <Loading />
        ) : atRisk.length === 0 ? (
          <Empty>Nobody at risk. Great retention!</Empty>
        ) : (
          <ul className="risk-list">
            {atRisk.map((m) => (
              <li key={m.userId}>
                <div>
                  <strong>{m.name ?? 'Unnamed member'}</strong>
                  <span className="muted small">
                    {' '}
                    · {m.phone} · last visit {lastVisitLabel(m.lastVisit, today).toLowerCase()}
                  </span>
                </div>
                <NudgeButton gymId={gym.id} userId={m.userId} who={m.name ?? m.phone} kind="inactive" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
