import { ADMIN_ROLES, STAFF_ROLES, type Role } from '@gymverse/shared';

export const isStaff = (role: Role | null | undefined): boolean => !!role && STAFF_ROLES.includes(role);
export const isAdmin = (role: Role | null | undefined): boolean => !!role && ADMIN_ROLES.includes(role);
export const isOwner = (role: Role | null | undefined): boolean => role === 'owner';

export const ROLE_LABELS: Record<Role, string> = {
  member: 'Member',
  trainer: 'Trainer',
  manager: 'Manager',
  owner: 'Owner',
};
