import type { FeatureKey, Role } from '@gymverse/shared';
import type { IconName } from '../components/Icon';
import { isAdmin, isStaff } from './roles';

export type Section =
  | 'overview'
  | 'members'
  | 'classes'
  | 'plans'
  | 'revenue'
  | 'workouts'
  | 'nutrition'
  | 'resources'
  | 'community'
  | 'announcements'
  | 'support'
  | 'branding'
  | 'qr'
  | 'admin';

export interface SectionDef {
  id: Section;
  label: string;
  icon: IconName;
  /** Member-app feature this section manages; hidden/greyed when the gym switched it off. */
  feature?: FeatureKey;
  /** Trainers see this section (managers and owners see everything). */
  trainer?: boolean;
}

export const SECTION_GROUPS: Array<{ id: string; label: string; sections: SectionDef[] }> = [
  {
    id: 'gym',
    label: 'Gym',
    sections: [
      { id: 'overview', label: 'Overview', icon: 'overview', trainer: true },
      { id: 'members', label: 'Members', icon: 'users', trainer: true },
      { id: 'classes', label: 'Classes', icon: 'calendar', feature: 'classes', trainer: true },
      { id: 'plans', label: 'Plans', icon: 'card' },
      { id: 'revenue', label: 'Revenue', icon: 'rupee' },
    ],
  },
  {
    id: 'content',
    label: 'Member content',
    sections: [
      { id: 'workouts', label: 'Workouts', icon: 'dumbbell', feature: 'workouts', trainer: true },
      { id: 'nutrition', label: 'Nutrition', icon: 'leaf', feature: 'nutrition' },
      { id: 'resources', label: 'Resources', icon: 'book', feature: 'resources' },
      { id: 'community', label: 'Community', icon: 'chat', feature: 'community' },
    ],
  },
  {
    id: 'engage',
    label: 'Engage & setup',
    sections: [
      { id: 'announcements', label: 'Announcements', icon: 'megaphone', feature: 'announcements' },
      { id: 'support', label: 'Support', icon: 'lifebuoy', feature: 'support', trainer: true },
      { id: 'branding', label: 'Branding', icon: 'palette' },
      { id: 'qr', label: 'Join QR', icon: 'qr' },
    ],
  },
];

/** Platform (GymVerse staff) console, only for me.isPlatformAdmin. */
export const ADMIN_GROUP = { id: 'platform', label: 'Platform', sections: [{ id: 'admin', label: 'Admin', icon: 'shield' }] as SectionDef[] };

export const ALL_SECTIONS: SectionDef[] = [...SECTION_GROUPS, ADMIN_GROUP].flatMap((g) => g.sections);

export interface NavOptions {
  /** Show the platform admin console (GymVerse staff). */
  platformAdmin?: boolean;
}

export type NavState = 'enabled' | 'disabled';
export interface NavItem extends SectionDef {
  state: NavState;
}

/**
 * Which sections a role sees for a gym. Trainers get Overview, Members, Classes, Workouts and the
 * Support inbox; managers/owners get everything. Sections whose feature is switched off are hidden
 * for trainers and shown greyed ("Turn on in Branding") for admins.
 */
export function navFor(
  role: Role,
  enabledFeatures: readonly FeatureKey[],
  opts: NavOptions = {},
): Array<{ id: string; label: string; items: NavItem[] }> {
  const admin = isAdmin(role);
  if (!isStaff(role)) return [];
  const groups = opts.platformAdmin ? [...SECTION_GROUPS, ADMIN_GROUP] : SECTION_GROUPS;
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.sections
      .filter((s) => admin || s.trainer || s.id === 'admin')
      .map((s): NavItem => ({ ...s, state: !s.feature || enabledFeatures.includes(s.feature) ? 'enabled' : 'disabled' }))
      .filter((s) => admin || s.state === 'enabled'),
  })).filter((g) => g.items.length > 0);
}

/** True when `section` is usable (visible and its feature is on) for this role and gym. */
export function canOpen(section: Section, role: Role, enabledFeatures: readonly FeatureKey[], opts: NavOptions = {}): boolean {
  return navFor(role, enabledFeatures, opts).some((g) => g.items.some((i) => i.id === section && i.state === 'enabled'));
}
