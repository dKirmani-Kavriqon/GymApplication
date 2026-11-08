import { dayKey, formatInr, type Gym, type RevenueReport } from '@gymverse/shared';
import { useApiData } from '../lib/useApi';
import { formatDate, pluralize, shortDayLabel } from '../lib/format';
import { stagger } from '../lib/motion';
import { BarChart } from '../components/BarChart';
import { Icon } from '../components/Icon';
import { CountUp, Empty, ErrorBanner, Loading, PageHeader } from '../components/ui';
import { NudgeButton } from '../components/NudgeButton';

/** "+12% vs last month" / "−5% vs last month" / "New this month". */
export function monthChange(thisMonth: number, lastMonth: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (lastMonth <= 0) return thisMonth > 0 ? { text: 'New this month', tone: 'up' } : { text: 'No payments yet', tone: 'flat' };
  const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
  if (pct === 0) return { text: 'Same as last month', tone: 'flat' };
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs last month`, tone: pct > 0 ? 'up' : 'down' };
}

/** Whole rupees for tiles (count-up frames would otherwise flash paise decimals). */
export const inr = (paise: number) => formatInr(Math.round(paise / 100) * 100);

export function Revenue({ gym }: { gym: Gym }) {
  const { data: r, error, loading } = useApiData<RevenueReport>(`/gyms/${gym.id}/reports/revenue`);
  const today = dayKey(new Date(), gym.timezone);


  const change = r ? monthChange(r.collectedThisMonthPaise, r.collectedLastMonthPaise) : null;

  return (
    <div className="stack-lg">
      <PageHeader eyebrow="Money" title="Revenue" subtitle="Payments collected in the app, renewals coming up, and what coupons cost you." />
      <ErrorBanner message={error} />
      {loading && !r ? (
        <Loading rows={4} />
      ) : r ? (
        <>
          <div className="stat-grid">
            <div className="card stat stat-hero rise" style={stagger(0)}>
              <span className="stat-label">Collected this month</span>
              <span className="stat-value" data-testid="rev-this-month">
                <CountUp value={r.collectedThisMonthPaise} format={inr} />
              </span>
              <span className={`trend trend-${change!.tone}`}>{change!.text}</span>
            </div>
            <div className="card stat rise" style={stagger(1)}>
              <span className="stat-label">Last month</span>
              <span className="stat-value" data-testid="rev-last-month">
                <CountUp value={r.collectedLastMonthPaise} format={inr} />
              </span>
            </div>
            <div className="card stat rise" style={stagger(2)}>
              <span className="stat-label">Members without a plan</span>
              <span className="stat-value" data-testid="rev-unpaid">
                <CountUp value={r.unpaidMembers} />
              </span>
            </div>
            <div className="card stat rise" style={stagger(3)}>
              <span className="stat-label">Coupon discounts this month</span>
              <span className="stat-value" data-testid="rev-coupons">
                <CountUp value={r.couponDiscountsThisMonthPaise} format={inr} />
              </span>
            </div>
          </div>

          <section className="card rise" style={stagger(4)}>
            <h2>Collected · last 30 days</h2>
            <BarChart
              title="Revenue in the last 30 days"
              unit="₹"
              valueLabel={() => ''}
              bars={r.daily.map((d, i) => ({
                key: d.day,
                label: shortDayLabel(d.day),
                value: Math.round(d.paise / 100),
                showLabel: i % 5 === (r.daily.length - 1) % 5,
                highlight: d.day === today,
              }))}
            />
          </section>

          <div className="two-col-wide">
            <section className="card rise" style={stagger(5)}>
              <h2>By plan · this month</h2>
              {r.byPlan.length === 0 ? (
                <Empty icon="card">No plan sales yet this month.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table" aria-label="Revenue by plan">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th className="num">Sold</th>
                        <th className="num">Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byPlan.map((p) => (
                        <tr key={p.planId}>
                          <td>{p.planName}</td>
                          <td className="num">{p.count}</td>
                          <td className="num">{inr(p.paise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card rise" style={stagger(6)}>
              <div className="section-head">
                <h2>Renewals due · next 7 days</h2>
                <span className="muted small">{pluralize(r.renewalsDue.length, 'member')}</span>
              </div>
              {r.renewalsDue.length === 0 ? (
                <Empty icon="calendar">Nobody's membership ends this week.</Empty>
              ) : (
                <ul className="risk-list" aria-label="Renewals due">
                  {r.renewalsDue.map((m) => (
                    <li key={m.userId} data-testid="renewal">
                      <div>
                        <strong>{m.name ?? 'Unnamed member'}</strong>
                        <span className="muted small">
                          {' '}
                          · {m.planName} · ends {formatDate(m.endsAt, gym.timezone)}
                        </span>
                      </div>
                      <NudgeButton gymId={gym.id} userId={m.userId} who={m.name ?? m.phone} kind="renewal" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
