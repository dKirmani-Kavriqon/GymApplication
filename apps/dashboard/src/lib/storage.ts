/** localStorage wrapped so private mode / blocked storage never crashes the app. */
export const TOKEN_KEY = 'gymverse.dashboard.token';
export const GYM_KEY = 'gymverse.dashboard.gymId';

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the session simply won't survive a reload.
  }
}
