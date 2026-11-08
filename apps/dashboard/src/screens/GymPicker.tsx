import type { GymMembership } from '@gymverse/shared';
import { ROLE_LABELS, isStaff } from '../lib/roles';
import { Icon, StarMark } from '../components/Icon';

interface Props {
  memberships: GymMembership[];
  onPick: (gymId: string) => void;
  onCreate: () => void;
  onLogout: () => void;
}

export function GymPicker({ memberships, onPick, onCreate, onLogout }: Props) {
  const staff = memberships.filter((m) => isStaff(m.role));
  const memberOnly = memberships.filter((m) => !isStaff(m.role));
  return (
    <div className="auth-page">
      <div className="auth-card card picker">
        <div className="brand-mark">
          <StarMark size={22} className="brand-star" /> GymVerse
        </div>
        <h1>Choose a gym</h1>
        {staff.length > 0 ? (
          <ul className="gym-list">
            {staff.map((m) => (
              <li key={m.gym.id}>
                <button type="button" className="gym-option" onClick={() => onPick(m.gym.id)}>
                  <span className="gym-swatch" style={{ background: m.gym.branding.primaryColor }}>
                    {m.gym.branding.gymName[0]?.toUpperCase()}
                  </span>
                  <span className="gym-option-text">
                    <strong>{m.gym.branding.gymName}</strong>
                    <span className="muted">
                      {m.gym.city} · {ROLE_LABELS[m.role]}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">You don't manage a gym yet. Set one up in about two minutes.</p>
        )}
        {memberOnly.length > 0 && (
          <p className="muted small">
            You're a member at {memberOnly.map((m) => m.gym.branding.gymName).join(', ')}. The dashboard is for gym staff; use the
            GymVerse app to check in.
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={onCreate}>
          Create a new gym
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
