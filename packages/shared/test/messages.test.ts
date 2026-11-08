import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '../src/index';

const first = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? null : r.error.issues[0]!.message;
};

describe('friendly validation messages', () => {
  it('covers required fields and types', () => {
    expect(first(z.object({ a: z.string() }), {})).toBe('This is required');
    expect(first(z.number(), 'x')).toBe('Enter a number');
    expect(first(z.string(), 5)).toBe('Enter some text');
    expect(first(z.array(z.string()), 'x')).toBe('Expected a list');
    expect(first(z.boolean(), 'x')).toBe('Choose yes or no');
    expect(first(z.object({}), 'x')).toMatch(/object/i);
  });

  it('covers lengths, ranges and list sizes', () => {
    expect(first(z.string().min(1), '')).toBe('This is required');
    expect(first(z.string().min(2), 'a')).toBe('Enter at least 2 characters');
    expect(first(z.string().max(1), 'ab')).toBe('Keep it to 1 character or fewer');
    expect(first(z.string().max(3), 'abcd')).toBe('Keep it to 3 characters or fewer');
    expect(first(z.number().min(1), 0)).toBe('Must be at least 1');
    expect(first(z.number().positive(), 0)).toBe('Must be more than 0');
    expect(first(z.number().int().max(10), 11)).toBe('Must be at most 10');
    expect(first(z.number().lt(5), 5)).toBe('Must be less than 5');
    expect(first(z.array(z.number()).min(1), [])).toBe('Add at least 1 item');
    expect(first(z.array(z.number()).max(2), [1, 2, 3])).toBe('No more than 2 items');
    expect(first(z.date().min(new Date('2026-01-01')), new Date('2025-01-01'))).toBe('That date is too early');
    expect(first(z.date().max(new Date('2026-01-01')), new Date('2027-01-01'))).toBe('That date is too late');
    expect(first(z.number().multipleOf(5), 7)).toBe('Must be a multiple of 5');
  });

  it('covers formats, choices and unknown keys', () => {
    expect(first(z.string().email(), 'nope')).toBe('Enter a valid email address');
    expect(first(z.string().url(), 'nope')).toBe('Enter a valid link, starting with https://');
    expect(first(z.string().datetime(), 'nope')).toBe('Enter a valid date');
    expect(first(z.string().uuid(), 'nope')).toBe('Invalid id');
    expect(first(z.string().regex(/^a$/), 'b')).toBe('That format is not valid');
    expect(first(z.enum(['a', 'b']), 'c')).toBe('Choose one of: a, b');
    expect(first(z.enum(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'z')).toBe('Choose one of the options');
    expect(first(z.strictObject({}), { x: 1 })).toBe('Unexpected field: x');
  });

  it('keeps messages written on a schema', () => {
    expect(first(z.string().min(2, 'Type at least 2 characters to search'), 'a')).toBe('Type at least 2 characters to search');
  });
});
