import { z } from 'zod';

/**
 * Plain-language validation messages for every schema in the apps and the API (members and gym
 * owners see these). A message written on a schema itself (`.min(2, '…')`) still wins.
 * Installed once when `@gymverse/shared` is imported.
 */

type Issue = z.core.$ZodRawIssue;

const plural = (n: number | bigint, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;

export function friendlyMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined || issue.input === null) return 'This is required';
      if (issue.expected === 'number' || issue.expected === 'int') return 'Enter a number';
      if (issue.expected === 'string') return 'Enter some text';
      if (issue.expected === 'array') return 'Expected a list';
      if (issue.expected === 'boolean') return 'Choose yes or no';
      return undefined;
    case 'too_small': {
      const n = issue.minimum as number;
      if (issue.origin === 'string') return Number(n) <= 1 ? 'This is required' : `Enter at least ${plural(n, 'character', 'characters')}`;
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
        return issue.inclusive === false ? `Must be more than ${n}` : `Must be at least ${n}`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') return `Add at least ${plural(n, 'item', 'items')}`;
      if (issue.origin === 'date') return 'That date is too early';
      return undefined;
    }
    case 'too_big': {
      const n = issue.maximum as number;
      if (issue.origin === 'string') return `Keep it to ${plural(n, 'character', 'characters')} or fewer`;
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
        return issue.inclusive === false ? `Must be less than ${n}` : `Must be at most ${n}`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') return `No more than ${plural(n, 'item', 'items')}`;
      if (issue.origin === 'date') return 'That date is too late';
      return undefined;
    }
    case 'invalid_format':
      if (issue.format === 'email') return 'Enter a valid email address';
      if (issue.format === 'url') return 'Enter a valid link, starting with https://';
      if (issue.format === 'datetime' || issue.format === 'date') return 'Enter a valid date';
      if (issue.format === 'uuid') return 'Invalid id';
      return 'That format is not valid';
    case 'invalid_value':
      return issue.values.length <= 6 ? `Choose one of: ${issue.values.map(String).join(', ')}` : 'Choose one of the options';
    case 'not_multiple_of':
      return `Must be a multiple of ${issue.divisor}`;
    case 'unrecognized_keys':
      return `Unexpected field: ${issue.keys.join(', ')}`;
    default:
      return undefined;
  }
}

z.config({ customError: friendlyMessage });
