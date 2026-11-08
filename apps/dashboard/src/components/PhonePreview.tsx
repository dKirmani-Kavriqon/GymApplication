import type { CSSProperties } from 'react';
import { buildTheme, type Branding, type FeatureKey, type ThemeMode } from '@gymverse/shared';
import { Icon, StarMark, type IconName } from './Icon';

interface Props {
  branding: Branding & { welcomeMessage?: string | null };
  mode: ThemeMode;
  features: readonly FeatureKey[];
}

const QUICK_ACTIONS: Array<{ feature: FeatureKey; label: string; icon: IconName }> = [
  { feature: 'classes', label: 'Classes', icon: 'calendar' },
  { feature: 'workouts', label: 'Workouts', icon: 'dumbbell' },
  { feature: 'payments', label: 'Membership', icon: 'card' },
  { feature: 'community', label: 'Challenge', icon: 'trophy' },
  { feature: 'nutrition', label: 'Nutrition', icon: 'leaf' },
  { feature: 'resources', label: 'Resources', icon: 'book' },
  { feature: 'progress', label: 'Progress', icon: 'chart' },
];

/**
 * The member app's Home screen (Burgundy & Beige revamp), drawn with the same `buildTheme()`
 * tokens as the mobile app so owners see exactly what members will get.
 */
export function PhonePreview({ branding, mode, features }: Props) {
  const t = buildTheme({ ...branding, themePreference: mode }, mode);
  const has = (f: FeatureKey) => features.includes(f);
  const tabs: Array<{ label: string; icon: IconName }> = [
    { label: 'Home', icon: 'home' },
    ...(has('classes') ? [{ label: 'Classes', icon: 'calendar' as const }] : []),
    ...(has('workouts') ? [{ label: 'Workouts', icon: 'dumbbell' as const }] : []),
    ...(has('progress') ? [{ label: 'Progress', icon: 'chart' as const }] : []),
    { label: 'Me', icon: 'user' },
  ];
  const quick = QUICK_ACTIONS.filter((q) => has(q.feature)).slice(0, 4);
  const card: CSSProperties = {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: t.radius.lg,
    boxShadow: `0 8px 22px ${t.shadow}`,
  };
  const rowTitle: CSSProperties = { color: t.heading };

  return (
    <div className="phone" data-testid="phone-preview" data-mode={t.mode} role="group" aria-label={`Member app home screen, ${t.mode} mode`}>
      <div className="phone-screen" style={{ background: t.background, color: t.text }}>
        <div className="pv-blob-dot" style={{ background: t.tint2 }} aria-hidden />
        <div className="pv-blob" style={{ background: t.primary }} aria-hidden />
        <div className="pv-status" style={{ color: t.text }}>
          <span>9:41</span>
          <i aria-hidden />
        </div>
        <span className="pv-bell" style={{ background: t.surface, color: t.primaryText, boxShadow: `0 6px 16px ${t.shadow}` }}>
          <Icon name="bell" size={18} />
          <span className="pv-bell-dot" style={{ background: t.accent }} />
        </span>

        <div className="pv-scroll">
          <div className="pv-brand">
            {branding.logoUrl ? (
              <img className="pv-logo" src={branding.logoUrl} alt={`${branding.gymName} logo`} />
            ) : (
              <span style={{ color: t.primaryText }}>
                <StarMark size={26} />
              </span>
            )}
            <span className="pv-gym" data-testid="preview-gym-name" style={{ color: t.textMuted }}>
              {branding.gymName || 'Your gym'}
            </span>
          </div>

          <div>
            <div className="pv-hello">Good morning,</div>
            <div className="pv-name" style={{ color: t.heading }}>
              Ravi!
            </div>
            {branding.tagline && (
              <div className="pv-sub" style={{ color: t.textMuted }}>
                {branding.tagline}
              </div>
            )}
          </div>

          <div className="pv-search" style={{ background: t.tint, color: t.textMuted }}>
            <Icon name="search" size={15} />
            Search classes, workouts…
          </div>

          {has('checkin') && (
            <>
              <div
                className="pv-card pv-progress"
                data-testid="preview-streak"
                style={{ ...card, border: 0, background: `linear-gradient(135deg, ${t.tint} 0%, ${t.tint2} 100%)` }}
              >
                <div className="pv-pc-top">
                  <span className="pv-pc-ico" style={{ background: t.primary, color: t.onPrimary }}>
                    <Icon name="chart" size={14} />
                  </span>
                  Weekly goal · 3 of 4 visits
                  {has('badges') && (
                    <span className="pv-chip" style={{ background: t.accent, color: t.onAccent }}>
                      5-day streak
                    </span>
                  )}
                </div>
                <div className="pv-pc-row">
                  <div>
                    <div className="pv-big" style={{ color: t.heading }}>
                      75<small>%</small>
                    </div>
                    <div className="pv-up" style={{ color: t.primaryText }}>
                      ↑ 1 more than last week
                    </div>
                  </div>
                  <svg className="pv-spark" viewBox="0 0 108 38" fill="none" aria-hidden style={{ color: t.primary }}>
                    <path
                      d="M2 30 C14 30 16 18 26 20 S38 34 48 26 58 8 68 14 80 30 88 16 98 4 106 8"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="pv-bar" style={{ background: `${t.surface}B3` }}>
                  <b style={{ width: '75%', background: t.primary }} />
                </div>
              </div>
              <span
                className="pv-btn"
                data-testid="preview-checkin"
                style={{ background: t.primary, color: t.onPrimary, borderRadius: t.radius.pill }}
              >
                Check in now <Icon name="arrowRight" size={16} />
              </span>
            </>
          )}

          {quick.length > 0 && (
            <>
              <div className="pv-row-title" style={rowTitle}>
                Quick actions{' '}
                <span style={{ color: t.primaryText }} className="pv-see-all">
                  See all →
                </span>
              </div>
              <div className="pv-qa" data-testid="preview-quick-actions">
                {quick.map((q) => (
                  <div key={q.feature}>
                    <span style={{ background: t.tint, color: t.primaryText }}>
                      <Icon name={q.icon} size={20} />
                    </span>
                    {q.label}
                  </div>
                ))}
              </div>
            </>
          )}

          {has('classes') && (
            <>
              <div className="pv-row-title" style={rowTitle}>
                Upcoming
              </div>
              <div className="pv-card pv-up-item" style={card} data-testid="preview-next-class">
                <div className="pv-date" style={{ background: t.primary, color: t.onPrimary }}>
                  TUE<b>10</b>
                </div>
                <div className="pv-t">
                  <b style={{ color: t.text }}>Morning HIIT</b>
                  <span style={{ color: t.textMuted }}>7:00 – 7:45 AM · Coach Vikram</span>
                </div>
                <span style={{ color: t.textMuted }}>
                  <Icon name="chevronRight" size={16} />
                </span>
              </div>
            </>
          )}

          {branding.welcomeMessage && (
            <div className="pv-card pv-welcome" style={card} data-testid="preview-welcome">
              <span style={{ color: t.primaryText }}>
                <StarMark size={16} />
              </span>
              <span style={{ color: t.textMuted }}>{branding.welcomeMessage}</span>
            </div>
          )}
        </div>

        <nav
          className="pv-tabbar"
          aria-label="Preview tabs"
          style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: `0 10px 24px ${t.shadow}`, gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
        >
          {tabs.map((tab, i) => (
            <div key={tab.label} style={{ color: i === 0 ? t.primaryText : t.textMuted, fontWeight: i === 0 ? 800 : 600 }}>
              <Icon name={tab.icon} size={19} />
              <span>{tab.label}</span>
            </div>
          ))}
        </nav>
        <div className="pv-home-ind" style={{ background: t.text }} aria-hidden />
      </div>
    </div>
  );
}
