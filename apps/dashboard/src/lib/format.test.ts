import {
  hourLabel,
  isValidPhone,
  lastVisitLabel,
  membershipLabel,
  normalizePhone,
  pluralize,
  rupeesToPaise,
  shortDayLabel,
  zonedLocalToIso,
} from './format';
import { isAdmin, isOwner, isStaff } from './roles';
import { joinLink, joinQrDataUrl } from './qr';
import { PLAN_TEMPLATES } from './templates';

describe('normalizePhone', () => {
  it('assumes +91 for 10-digit numbers and strips formatting', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 (98765)-43210')).toBe('+919876543210');
    expect(normalizePhone('+14155550100')).toBe('+14155550100');
  });
  it('validates', () => {
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
  });
});

describe('rupeesToPaise', () => {
  it('converts rupee strings to paise', () => {
    expect(rupeesToPaise('1499')).toBe(149900);
    expect(rupeesToPaise('₹12,999')).toBe(1299900);
    expect(rupeesToPaise('99.5')).toBe(9950);
    expect(rupeesToPaise('0')).toBe(0);
  });
  it('rejects invalid amounts', () => {
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
    expect(rupeesToPaise('1.234')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });
});

describe('zonedLocalToIso', () => {
  it('converts gym wall-clock time to UTC ISO', () => {
    expect(zonedLocalToIso('2026-11-20', '07:30', 'Asia/Kolkata')).toBe('2026-11-20T02:00:00.000Z');
    expect(zonedLocalToIso('2026-11-20', '00:15', 'Asia/Kolkata')).toBe('2026-11-19T18:45:00.000Z');
    expect(zonedLocalToIso('2026-07-01', '09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedLocalToIso('2026-12-01', '09:00', 'America/New_York')).toBe('2026-12-01T14:00:00.000Z');
    expect(zonedLocalToIso('2026-11-20', '07:30', 'UTC')).toBe('2026-11-20T07:30:00.000Z');
  });
  it('throws on missing input', () => {
    expect(() => zonedLocalToIso('', '07:30', 'UTC')).toThrow();
    expect(() => zonedLocalToIso('2026-11-20', '', 'UTC')).toThrow();
  });
});

describe('labels', () => {
  it('formats hours', () => {
    expect([0, 6, 12, 18].map(hourLabel)).toEqual(['12a', '6a', '12p', '6p']);
  });
  it('formats days', () => {
    expect(shortDayLabel('2026-11-08')).toBe('Sun 8');
  });
  it('formats last visit', () => {
    expect(lastVisitLabel(null, '2026-11-08')).toBe('Never');
    expect(lastVisitLabel('2026-11-08', '2026-11-08')).toBe('Today');
    expect(lastVisitLabel('2026-11-07', '2026-11-08')).toBe('Yesterday');
    expect(lastVisitLabel('2026-10-25', '2026-11-08')).toBe('14 days ago');
  });
  it('formats membership state', () => {
    expect(membershipLabel({ state: 'active', daysLeft: 20, endsAt: null })).toBe('Active · 20d left');
    expect(membershipLabel({ state: 'expiring', daysLeft: 3, endsAt: null })).toBe('Expiring · 3d left');
    expect(membershipLabel({ state: 'expired', daysLeft: 0, endsAt: null })).toBe('Expired');
    expect(membershipLabel({ state: 'none', daysLeft: 0, endsAt: null })).toBe('No plan');
  });
  it('pluralizes', () => {
    expect(pluralize(1, 'row')).toBe('1 row');
    expect(pluralize(2, 'row')).toBe('2 rows');
    expect(pluralize(2, 'person', 'people')).toBe('2 people');
  });
});

describe('roles', () => {
  it('groups roles like the API', () => {
    expect(['member', 'trainer', 'manager', 'owner'].map((r) => isStaff(r as never))).toEqual([false, true, true, true]);
    expect(['member', 'trainer', 'manager', 'owner'].map((r) => isAdmin(r as never))).toEqual([false, false, true, true]);
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('manager')).toBe(false);
  });
});

describe('qr', () => {
  it('encodes the join deep link as an SVG data URL', async () => {
    expect(joinLink('FLEX42')).toBe('gymverse://join/FLEX42');
    const url = await joinQrDataUrl('FLEX42');
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(url)).toContain('<svg');
  });
});

describe('plan templates', () => {
  it('match PRD §7', () => {
    expect(PLAN_TEMPLATES.map((t) => [t.name, t.durationDays, t.priceRupees])).toEqual([
      ['Monthly', 30, '1499'],
      ['Quarterly', 90, '3999'],
      ['Yearly', 365, '12999'],
    ]);
  });
});
