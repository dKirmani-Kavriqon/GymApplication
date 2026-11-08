import { stagger } from '../lib/motion';

interface Bar {
  key: string;
  label: string;
  value: number;
  /** Show the label under the bar (others keep a tooltip only). */
  showLabel?: boolean;
  highlight?: boolean;
}

/** Hand-rolled CSS bar chart (no chart library). Bars grow up from 0 on mount (CSS, off under reduced motion). */
export function BarChart({
  bars,
  title,
  unit = 'check-ins',
  valueLabel = (v) => (v > 0 ? String(v) : ''),
}: {
  bars: Bar[];
  title: string;
  unit?: string;
  valueLabel?: (v: number) => string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const tooltip = (b: Bar) => (unit === '₹' ? `${b.label}: ₹${b.value.toLocaleString('en-IN')}` : `${b.label}: ${b.value} ${unit}`);
  return (
    <figure className="chart" aria-label={title}>
      <div className="chart-bars">
        {bars.map((b, i) => (
          <div key={b.key} className="chart-col" title={tooltip(b)}>
            <span className="chart-value">{valueLabel(b.value)}</span>
            <div
              className={`chart-bar${b.highlight ? ' is-highlight' : ''}`}
              style={{ height: `${Math.max(b.value > 0 ? 4 : 1, (b.value / max) * 100)}%`, ...stagger(Math.floor(i / 3)) }}
              data-testid="chart-bar"
              aria-label={`${b.label}: ${b.value}`}
            />
            <span className="chart-label">{b.showLabel === false ? '' : b.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
