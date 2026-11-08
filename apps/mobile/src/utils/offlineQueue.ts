import type { Api } from '../api/client';
import type { KeyValueStorage } from '../state/session';

/**
 * Offline check-ins (PRD §10: "check-in works offline and syncs later").
 * A check-in that fails for lack of network is saved with its real time and sent when the app
 * is online again; the server accepts it if it's under 12 hours old.
 */
const KEY = 'gv.pendingCheckIns';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface PendingCheckIn {
  gymId: string;
  occurredAt: string;
}

async function read(storage: KeyValueStorage): Promise<PendingCheckIn[]> {
  try {
    const raw = await storage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingCheckIn[]) : [];
  } catch {
    return [];
  }
}

export async function queueCheckIn(storage: KeyValueStorage, item: PendingCheckIn): Promise<void> {
  const list = await read(storage);
  if (list.some((p) => p.gymId === item.gymId && p.occurredAt.slice(0, 10) === item.occurredAt.slice(0, 10))) return;
  await storage.setItem(KEY, JSON.stringify([...list, item]));
}

export async function pendingFor(storage: KeyValueStorage, gymId: string): Promise<PendingCheckIn[]> {
  return (await read(storage)).filter((p) => p.gymId === gymId);
}

/** Sends queued check-ins. Keeps ones that fail for network reasons; drops ones the server rejects or that are too old. */
export async function flushCheckIns(storage: KeyValueStorage, api: Api, now = new Date()): Promise<number> {
  const list = await read(storage);
  if (!list.length) return 0;
  const keep: PendingCheckIn[] = [];
  let sent = 0;
  for (const item of list) {
    if (now.getTime() - new Date(item.occurredAt).getTime() > MAX_AGE_MS) continue;
    try {
      await api.checkInWith(item.gymId, { method: 'button', occurredAt: item.occurredAt });
      sent++;
    } catch (err) {
      if ((err as { status?: number }).status === 0) keep.push(item);
    }
  }
  await storage.setItem(KEY, JSON.stringify(keep));
  return sent;
}
