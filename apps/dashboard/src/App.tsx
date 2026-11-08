import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { buildTheme, type AdminGymRow, type FreezeRequest, type Gym, type MeResponse, type Role } from '@gymverse/shared';
import { ApiError, api, errorMessage, getToken, onUnauthorized, setToken } from './lib/api';
import { GYM_KEY, readStorage, writeStorage } from './lib/storage';
import { ROLE_LABELS, isAdmin, isStaff } from './lib/roles';
import { canOpen, navFor, type Section } from './lib/nav';
import { ToastProvider } from './components/Toast';
import { Icon, StarMark } from './components/Icon';
import { FeatureOffBanner } from './components/ui';
import { Login } from './screens/Login';
import { GymPicker } from './screens/GymPicker';
import { Onboarding } from './screens/Onboarding';
import { Overview } from './screens/Overview';
import { Members } from './screens/Members';
import { Classes } from './screens/Classes';
import { Plans } from './screens/Plans';
import { Announcements } from './screens/Announcements';
import { BrandingStudio } from './screens/Branding';
import { JoinQr } from './screens/JoinQr';
import { Workouts } from './screens/Workouts';
import { Resources } from './screens/Resources';
import { Nutrition } from './screens/Nutrition';
import { Community } from './screens/Community';
import { Support } from './screens/Support';
import { Revenue } from './screens/Revenue';
import { Admin } from './screens/Admin';
import { useApiData } from './lib/useApi';

export type { Section } from './lib/nav';

type Phase = 'loading' | 'error' | 'login' | 'picker' | 'onboarding' | 'dashboard' | 'admin';

/**
 * The gym's own colours as CSS variables. The dashboard chrome stays Burgundy & Beige; these
 * only colour the gym avatar and gym badges.
 */
export function gymVars(gym: Gym): CSSProperties {
  const t = buildTheme({ ...gym.branding, themePreference: 'light' }, 'light');
  return {
    '--gym': t.primary,
    '--gym-ink': t.onPrimary,
    '--gym-text': t.primaryText,
    '--gym-accent': t.accent,
    '--gym-on-accent': t.onAccent,
  } as CSSProperties;
}

export function GymAvatar({ gym, size = 44 }: { gym: Gym; size?: number }) {
  if (gym.branding.logoUrl) return <img className="gym-avatar" src={gym.branding.logoUrl} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="gym-avatar gym-avatar-letter" style={{ ...gymVars(gym), width: size, height: size }} aria-hidden>
      {gym.branding.gymName.trim()[0]?.toUpperCase() ?? 'G'}
    </span>
  );
}

interface ShellProps {
  me: MeResponse;
  gym: Gym;
  role: Role;
  onGymUpdated: (gym: Gym) => void;
  /** Platform admin changed a gym (tier / suspension); patch it wherever the user is staff. */
  onGymPatched: (gymId: string, patch: Partial<Gym>) => void;
  onSwitchGym: () => void;
  onLogout: () => void;
}

const FEATURE_NAME: Partial<Record<Section, string>> = {
  classes: 'Classes',
  workouts: 'Workouts',
  nutrition: 'Nutrition',
  resources: 'Resources',
  community: 'Community',
  announcements: 'Announcements',
  support: 'Help & support',
};

function DashboardShell({ me, gym, role, onGymUpdated, onGymPatched, onSwitchGym, onLogout }: ShellProps) {
  const [section, setSection] = useState<Section>('overview');
  const staffGyms = me.memberships.filter((m) => isStaff(m.role)).length;
  const platformAdmin = !!me.isPlatformAdmin;
  const groups = navFor(role, gym.enabledFeatures, { platformAdmin });
  const visible = groups.flatMap((g) => g.items);
  const current = visible.find((i) => i.id === section) ?? visible[0];
  const active: Section = current?.id ?? 'overview';
  const off = current?.state === 'disabled';
  const admin = isAdmin(role);
  const openBranding = admin ? () => setSection('branding') : undefined;
  const features = gym.enabledFeatures;
  const onAdminGymChanged = (row: AdminGymRow) => onGymPatched(row.id, { suspended: row.suspended, planTier: row.planTier });
  // Pending pause requests drive the badge on Members (admins only; errors just hide the badge).
  const freezes = useApiData<{ requests: FreezeRequest[] }>(admin ? '/gyms/' + gym.id + '/freeze-requests?status=pending' : null);
  const pendingFreezes = admin && !freezes.error ? (freezes.data?.requests ?? []).filter((r) => r.status === 'pending').length : 0;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <StarMark size={22} className="brand-star" /> GymVerse
        </div>
        <div className="sidebar-gym">
          <GymAvatar gym={gym} />
          <div className="sidebar-gym-text">
            <strong>{gym.branding.gymName}</strong>
            <span className="muted small">
              {ROLE_LABELS[role]} · code {gym.joinCode}
            </span>
          </div>
        </div>
        <nav className="nav" aria-label="Dashboard sections">
          {groups.map((g) => (
            <div key={g.id} className="nav-group" role="group" aria-label={g.label}>
              <div className="nav-group-label" aria-hidden>
                {g.label}
              </div>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`nav-item${active === s.id ? ' is-active' : ''}${s.state === 'disabled' ? ' is-off' : ''}`}
                  aria-current={active === s.id ? 'page' : undefined}
                  data-state={s.state}
                  onClick={() => setSection(s.id)}
                >
                  <Icon name={s.icon} size={19} className="nav-icon" />
                  <span className="nav-text">
                    {s.label}
                    {s.state === 'disabled' && <small className="nav-off">Off · Turn on in Branding</small>}
                  </span>
                  {s.id === 'members' && pendingFreezes > 0 && (
                    <span className="nav-badge" aria-label={`${pendingFreezes} pending pause request${pendingFreezes === 1 ? '' : 's'}`}>
                      {pendingFreezes}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span className="user-dot" aria-hidden>
              {(me.user.name ?? 'U').trim()[0]?.toUpperCase()}
            </span>
            <span className="small">{me.user.name ?? me.user.phone}</span>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={onSwitchGym}>
              <Icon name="swap" size={16} />
              {staffGyms > 1 ? 'Switch gym' : 'Gyms'}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={onLogout}>
              <Icon name="logout" size={16} />
              Log out
            </button>
          </div>
        </div>
      </aside>
      <main className="main" id="main" key={gym.id}>
        {gym.suspended && (
          <div className="suspended-banner" data-testid="suspended-banner">
            <Icon name="lock" size={18} />
            <span>
              <strong>This gym's account is paused.</strong> Members and staff can't use GymVerse until it's reactivated. Contact GymVerse support.
            </span>
          </div>
        )}
        <div className="page" key={active}>
        {off && <FeatureOffBanner name={FEATURE_NAME[active] ?? current.label} onOpenBranding={openBranding} />}
        {active === 'overview' && <Overview gym={gym} showRevenue={admin} onOpenRevenue={() => setSection('revenue')} />}
        {active === 'members' && (
          <Members
            gym={gym}
            role={role}
            myUserId={me.user.id}
            showWorkouts={canOpen('workouts', role, features)}
            pendingFreezes={pendingFreezes}
            onFreezesChanged={() => void freezes.reload()}
          />
        )}
        {active === 'classes' && <Classes gym={gym} />}
        {active === 'plans' && <Plans gym={gym} role={role} />}
        {active === 'revenue' && <Revenue gym={gym} />}
        {active === 'admin' && platformAdmin && <Admin onGymChanged={onAdminGymChanged} />}
        {active === 'workouts' && <Workouts gym={gym} role={role} myUserId={me.user.id} />}
        {active === 'nutrition' && <Nutrition gym={gym} />}
        {active === 'resources' && <Resources gym={gym} />}
        {active === 'community' && <Community gym={gym} />}
        {active === 'announcements' && <Announcements gym={gym} role={role} />}
        {active === 'support' && <Support gym={gym} role={role} />}
        {active === 'branding' && <BrandingStudio key={gym.id} gym={gym} canEdit={admin} onSaved={onGymUpdated} />}
        {active === 'qr' && <JoinQr gym={gym} canManage={admin} />}
        </div>
      </main>
    </div>
  );
}

/** A platform admin who isn't staff at any gym lands on the Admin console (they can still create a gym). */
function PlatformHome({ me, onCreate, onLogout }: { me: MeResponse; onCreate: () => void; onLogout: () => void }) {
  return (
    <div className="platform-home">
      <header className="platform-bar">
        <div className="sidebar-brand">
          <StarMark size={22} className="brand-star" /> GymVerse
        </div>
        <div className="platform-bar-actions">
          <span className="small muted">{me.user.name ?? me.user.phone}</span>
          <button type="button" className="btn btn-small btn-primary" onClick={onCreate}>
            <Icon name="plus" size={16} /> Create a gym
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={onLogout}>
            <Icon name="logout" size={16} /> Log out
          </button>
        </div>
      </header>
      <main className="main platform-main" id="main">
        <div className="page">
          <Admin />
        </div>
      </main>
    </div>
  );
}

export function App() {
  const [phase, setPhase] = useState<Phase>(() => (getToken() ? 'loading' : 'login'));
  const [me, setMe] = useState<MeResponse | null>(null);
  const [gymId, setGymId] = useState<string | null>(() => readStorage(GYM_KEY));
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectGym = useCallback((id: string) => {
    setGymId(id);
    writeStorage(GYM_KEY, id);
    setPhase('dashboard');
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    writeStorage(GYM_KEY, null);
    setMe(null);
    setGymId(null);
    setPhase('login');
  }, []);

  const loadMe = useCallback(
    async (preferGymId?: string | null) => {
      setPhase('loading');
      try {
        const res = await api.get<MeResponse>('/me');
        setMe(res);
        const staff = res.memberships.filter((m) => isStaff(m.role));
        const want = preferGymId ?? readStorage(GYM_KEY);
        if (want && staff.some((m) => m.gym.id === want)) selectGym(want);
        else if (staff.length === 1) selectGym(staff[0].gym.id);
        else if (staff.length === 0) setPhase(res.isPlatformAdmin ? 'admin' : 'onboarding');
        else setPhase('picker');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setLoadError(errorMessage(err));
        setPhase('error');
      }
    },
    [logout, selectGym],
  );

  useEffect(() => {
    onUnauthorized(logout);
    if (getToken()) void loadMe();
    return () => onUnauthorized(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const membership = me?.memberships.find((m) => m.gym.id === gymId && isStaff(m.role)) ?? null;
  const hasStaffGym = !!me?.memberships.some((m) => isStaff(m.role));

  function updateGym(gym: Gym) {
    setMe((cur) => cur && { ...cur, memberships: cur.memberships.map((m) => (m.gym.id === gym.id ? { ...m, gym } : m)) });
  }

  let content;
  if (phase === 'login') {
    content = (
      <Login
        onLoggedIn={(token) => {
          setToken(token);
          void loadMe();
        }}
      />
    );
  } else if (phase === 'loading') {
    content = <div className="splash">Loading your gym…</div>;
  } else if (phase === 'error') {
    content = (
      <div className="auth-page">
        <div className="card auth-card stack">
          <h1>Can't load your account</h1>
          <div className="error-banner" role="alert">
            {loadError}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => loadMe()}>
            Try again
          </button>
          <button type="button" className="btn btn-secondary" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    );
  } else if (phase === 'picker' && me) {
    content = <GymPicker memberships={me.memberships} onPick={selectGym} onCreate={() => setPhase('onboarding')} onLogout={logout} />;
  } else if (phase === 'onboarding') {
    content = (
      <Onboarding
        onCancel={hasStaffGym ? () => setPhase('picker') : me?.isPlatformAdmin ? () => setPhase('admin') : undefined}
        onFinish={(gym) => {
          void loadMe(gym.id);
        }}
      />
    );
  } else if (phase === 'admin' && me) {
    content = <PlatformHome me={me} onCreate={() => setPhase('onboarding')} onLogout={logout} />;
  } else if (phase === 'dashboard' && me && membership) {
    content = (
      <DashboardShell
        me={me}
        gym={membership.gym}
        role={membership.role}
        onGymUpdated={updateGym}
        onGymPatched={(id, patch) =>
          setMe((cur) => cur && { ...cur, memberships: cur.memberships.map((m) => (m.gym.id === id ? { ...m, gym: { ...m.gym, ...patch } } : m)) })
        }
        onSwitchGym={() => setPhase('picker')}
        onLogout={logout}
      />
    );
  } else {
    content = <div className="splash">Loading…</div>;
  }

  return <ToastProvider>{content}</ToastProvider>;
}
