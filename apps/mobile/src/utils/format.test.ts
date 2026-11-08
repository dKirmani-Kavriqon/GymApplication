import { formatClassTime, greeting, initials, lastDays, parseJoinCode } from './format';
import { toE164 } from '../screens/onboarding/PhoneScreen';

describe('parseJoinCode', () => {
  it('reads codes from deep links, web links and raw text', () => {
    expect(parseJoinCode('gymverse://join/flex42')).toBe('FLEX42');
    expect(parseJoinCode('https://gymverse.app/join/AB12CD?ref=poster')).toBe('AB12CD');
    expect(parseJoinCode('  flex42 ')).toBe('FLEX42');
  });
  it('rejects anything else', () => {
    expect(parseJoinCode('hello')).toBeNull();
    expect(parseJoinCode('gymverse://join/TOOLONG1')).toBeNull();
  });
});

describe('toE164', () => {
  it('defaults to India and keeps explicit country codes', () => {
    expect(toE164('98765 43210')).toBe('+919876543210');
    expect(toE164('919876543210')).toBe('+919876543210');
    expect(toE164('+44 7700 900123')).toBe('+447700900123');
  });
});

describe('display helpers', () => {
  const now = new Date('2026-11-08T09:00:00');
  it('describes class times relative to today', () => {
    expect(formatClassTime('2026-11-08T18:30:00', now)).toBe('Today, 6:30 PM');
    expect(formatClassTime('2026-11-09T07:00:00', now)).toBe('Tomorrow, 7:00 AM');
    expect(formatClassTime('2026-11-12T12:05:00', now)).toBe('Thu 12 Nov, 12:05 PM');
  });
  it('greets by time of day', () => {
    expect(greeting(new Date('2026-11-08T07:00:00'))).toBe('Good morning');
    expect(greeting(new Date('2026-11-08T14:00:00'))).toBe('Good afternoon');
    expect(greeting(new Date('2026-11-08T20:00:00'))).toBe('Good evening');
  });
  it('makes initials and day ranges', () => {
    expect(initials('Ravi Kumar Singh')).toBe('RS');
    expect(initials(null)).toBe('🙂');
    expect(lastDays('2026-11-02', 3)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});
