/**
 * Small helpers shared by the feature screens (Train, Nutrition, Resources, Community, Support).
 * Generic on purpose; kept here so the core UI kit stays untouched.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import type { FavouriteKind } from '@gymverse/shared';
import { Button, Card, ErrorText, IconButton, Txt } from '../../components/ui';
import { usePulse } from '../../components/motion';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeContext';
import { useSession } from '../../state/session';
import { useGym } from '../../state/hooks';
import { formatDate } from '../../utils/format';

/** The API plus the active gym id, the two things every feature screen needs. */
export function useGymApi() {
  const { api, me } = useSession();
  const gym = useGym();
  return { api, gymId: gym.id, gym, me };
}

// ---------- tiny in-app event bus (keeps lists fresh after a detail screen changes something) ----------

type Handler = (payload?: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

export type BusTopic = 'routines:changed' | 'post:created' | 'post:updated' | 'post:deleted' | 'tickets:changed' | 'favourites:changed' | 'challenges:changed';

export function emit(topic: BusTopic, payload?: unknown): void {
  listeners.get(topic)?.forEach((h) => h(payload));
}

export function useBus(topic: BusTopic, handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: Handler = (p) => ref.current(p);
    let set = listeners.get(topic);
    if (!set) {
      set = new Set();
      listeners.set(topic, set);
    }
    set.add(h);
    return () => {
      set!.delete(h);
    };
  }, [topic]);
}

// ---------- loading / error gate ----------

/** Shows a spinner while loading, the API message (with Try again) on error, else the content. */
export function Gate({ loading, error, ready, onRetry, children }: { loading: boolean; error: string | null; ready: boolean; onRetry?: () => void; children: () => React.ReactNode }) {
  if (ready) return <>{children()}</>;
  if (error && !loading) {
    return (
      <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
        <ErrorText message={error} />
        {onRetry ? <Button label="Try again" variant="soft" size="md" full={false} icon="refresh-cw" onPress={onRetry} /> : null}
      </Card>
    );
  }
  return <Skeleton />;
}

/** In-content loading placeholder (the kit's Loading is a full-page skeleton with safe-area padding). */
export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  const t = useTheme();
  const pulse = usePulse();
  return (
    <Animated.View accessibilityLabel={label} accessibilityRole="progressbar" style={{ gap: 12, opacity: pulse }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ height: i === 0 ? 120 : 84, borderRadius: t.radius.lg, backgroundColor: t.surfaceAlt }} />
      ))}
    </Animated.View>
  );
}

// ---------- favourite heart ----------

/** Heart toggle. Optimistic: flips at once, rolls back with a toast if the server says no. */
export function FavouriteButton({
  kind,
  id,
  value,
  name,
  onChange,
  testID,
}: {
  kind: FavouriteKind;
  id: string;
  value: boolean;
  name: string;
  onChange?: (on: boolean) => void;
  testID?: string;
}) {
  const { api, gymId } = useGymApi();
  const toast = useToast();
  const [on, setOn] = useState(value);
  useEffect(() => setOn(value), [value]);

  async function toggle() {
    const next = !on;
    setOn(next);
    onChange?.(next);
    try {
      await api.setFavourite(gymId, kind, id, next);
      emit('favourites:changed');
    } catch (err) {
      setOn(!next);
      onChange?.(!next);
      toast.show({ title: 'Could not update favourites', body: (err as Error).message, icon: 'alert-circle' });
    }
  }

  return (
    <IconButton
      testID={testID}
      icon="heart"
      variant={on ? 'primary' : 'surface'}
      label={on ? `Remove ${name} from favourites` : `Save ${name} to favourites`}
      onPress={toggle}
    />
  );
}

// ---------- in-page confirm (instead of Alert dialogs) ----------

export function InlineConfirm({
  message,
  detail,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy,
  error,
  testID,
}: {
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
  testID?: string;
}) {
  return (
    <Card testID={testID} variant="tint" style={{ gap: 10 }}>
      <Txt variant="bodyStrong" color="heading" accessibilityRole="alert">
        {message}
      </Txt>
      {detail ? (
        <Txt variant="small" color="textMuted">
          {detail}
        </Txt>
      ) : null}
      <ErrorText message={error} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={cancelLabel} variant="ghost" size="md" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={confirmLabel} variant="danger" size="md" onPress={onConfirm} loading={busy} />
        </View>
      </View>
    </Card>
  );
}

// ---------- formatting ----------

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", else a date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return formatDate(iso);
}

/** 90 → "1:30" */
export function clockText(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function kg(n: number | null | undefined): string {
  if (n == null) return 'Bodyweight';
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
}

export function bigNumber(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole days from the local date `today` to the YYYY-MM-DD `day` (negative = in the past). */
export function daysUntil(day: string, today: Date = new Date()): number {
  const [y, m, d] = day.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86_400_000);
}
