import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { CHALLENGE_METRICS, labelOf, type Challenge, type ChallengeMetric, type Post } from '@gymverse/shared';
import { Avatar, Button, Card, Pill, ProgressBar, Txt } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useTheme } from '../../theme/ThemeContext';
import { tapFeedback } from '../../utils/feedback';
import { InlineConfirm, daysUntil, emit, plural, timeAgo, useGymApi } from '../train/common';

// ---------- posts ----------

export function roleLabel(role: Post['author']['role']): string | null {
  if (role === 'trainer') return 'Coach';
  if (role === 'manager' || role === 'owner') return 'Staff';
  return null;
}

/** Optimistic like: flips at once, settles on the server's count, rolls back (with a toast) on error. */
export function useLikeToggle() {
  const { api, gymId } = useGymApi();
  const toast = useToast();
  return async (post: Post, apply: (p: Post) => void) => {
    const on = !post.likedByMe;
    const optimistic = { ...post, likedByMe: on, likeCount: Math.max(0, post.likeCount + (on ? 1 : -1)) };
    apply(optimistic);
    try {
      const res = await api.setLike(gymId, post.id, on);
      const settled = { ...optimistic, likeCount: res.likeCount, likedByMe: res.likedByMe };
      apply(settled);
      emit('post:updated', settled);
    } catch (err) {
      apply(post);
      toast.show({ title: on ? 'Could not like the post' : 'Could not remove your like', body: (err as Error).message, icon: 'alert-circle' });
    }
  };
}

function ActionButton({ icon, label, text, onPress, active, testID }: { icon: IconName; label: string; text: string; onPress?: () => void; active?: boolean; testID?: string }) {
  const t = useTheme();
  const color = active ? t.primaryText : t.textMuted;
  const content = (
    <>
      <Icon name={icon} size={20} color={color} />
      <Txt variant="smallStrong" color={color}>
        {text}
      </Txt>
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minHeight: 48, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? t.tint : 'transparent' };
  if (!onPress) {
    return (
      <View style={style} accessibilityLabel={label} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active !== undefined ? { selected: active } : undefined}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={style}
    >
      {content}
    </Pressable>
  );
}

export function PostCard({
  post,
  onChange,
  onOpen,
  onDeleted,
  now,
  index,
}: {
  index?: number;
  post: Post;
  onChange: (p: Post) => void;
  onOpen?: () => void;
  onDeleted: (id: string) => void;
  now?: Date;
}) {
  const { api, gymId } = useGymApi();
  const like = useLikeToggle();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = roleLabel(post.author.role);
  const name = post.author.name ?? 'Member';

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deletePost(gymId, post.id);
      emit('post:deleted', post.id);
      onDeleted(post.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card testID={`post-${post.id}`} style={{ gap: 10 }} index={index}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={name} size={44} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt variant="bodyStrong">{post.mine ? `${name} (you)` : name}</Txt>
            {role ? <Pill label={role} tone="primary" /> : null}
            {post.hidden ? <Pill label="Hidden" tone="muted" /> : null}
          </View>
          <Txt variant="small" color="textMuted">
            {timeAgo(post.createdAt, now)}
          </Txt>
        </View>
      </View>
      {onOpen ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open post by ${name}`} onPress={onOpen}>
          <Txt numberOfLines={8}>{post.body}</Txt>
        </Pressable>
      ) : (
        <Txt style={{ fontSize: 16, lineHeight: 24 }}>{post.body}</Txt>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -8 }}>
        <ActionButton
          testID={`like-${post.id}`}
          icon="heart"
          active={post.likedByMe}
          text={String(post.likeCount)}
          label={`${post.likedByMe ? 'Unlike' : 'Like'}, ${plural(post.likeCount, 'like')}`}
          onPress={() => like(post, onChange)}
        />
        <ActionButton testID={`comments-${post.id}`} icon="message-circle" text={String(post.commentCount)} label={`${plural(post.commentCount, 'comment')}${onOpen ? ', open' : ''}`} onPress={onOpen} />
        <View style={{ flex: 1 }} />
        {post.mine && !confirming ? <ActionButton icon="trash-2" text="Delete" label="Delete your post" onPress={() => setConfirming(true)} /> : null}
      </View>
      {confirming ? (
        <InlineConfirm
          testID="confirm-delete-post"
          message="Delete this post?"
          detail="It will be removed for everyone, with its comments."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Card>
  );
}

// ---------- challenges ----------

const UNITS: Record<ChallengeMetric, [string, string]> = {
  checkins: ['check-in', 'check-ins'],
  workouts: ['workout', 'workouts'],
  classes: ['class', 'classes'],
};

export function metricUnit(metric: ChallengeMetric, n: number): string {
  return UNITS[metric][n === 1 ? 0 : 1];
}

export function metricLabel(metric: ChallengeMetric): string {
  return labelOf(CHALLENGE_METRICS, metric);
}

/** "12 days left" / "Starts in 3 days" / "Ended". */
export function challengeWhen(c: Challenge, now: Date = new Date()): string {
  if (c.status === 'ended') return 'Ended';
  if (c.status === 'upcoming') {
    const n = daysUntil(c.startsOn, now);
    return n <= 0 ? 'Starts today' : `Starts in ${plural(n, 'day')}`;
  }
  const n = daysUntil(c.endsOn, now);
  return n <= 0 ? 'Last day' : `${plural(n, 'day')} left`;
}

/** Join or leave; returns the updated challenge (or throws with the API message). */
export function useJoinToggle() {
  const { api, gymId } = useGymApi();
  return async (c: Challenge) => {
    const next = await api.setJoined(gymId, c.id, !c.joined);
    emit('challenges:changed', next);
    return next;
  };
}

export function ChallengeCard({ challenge, onPress, onChange, now, index }: { challenge: Challenge; onPress: () => void; onChange: (c: Challenge) => void; now?: Date; index?: number }) {
  const toggle = useJoinToggle();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const c = challenge;

  async function join() {
    setBusy(true);
    try {
      const next = await toggle(c);
      onChange(next);
      toast.show({ title: next.joined ? 'You joined the challenge' : 'You left the challenge', body: c.title });
    } catch (err) {
      toast.show({ title: 'Something went wrong', body: (err as Error).message, icon: 'alert-circle' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card testID={`challenge-${c.id}`} index={index}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${c.title}. ${metricLabel(c.metric)}. ${challengeWhen(c, now)}${c.joined ? `. ${c.myProgress} of ${c.target}` : ''}`}
        onPress={() => {
          tapFeedback();
          onPress();
        }}
        style={({ pressed }) => ({ gap: 8, opacity: pressed ? 0.7 : 1 })}
      >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="caption" color="textMuted">
            {metricLabel(c.metric)} · {challengeWhen(c, now)}
          </Txt>
          <Txt variant="h3" color="heading">
            {c.title}
          </Txt>
        </View>
        {c.joined ? <Pill label="Joined" tone="success" /> : null}
      </View>
      {c.joined ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="smallStrong">
              {c.myProgress} / {c.target} {metricUnit(c.metric, c.target)}
            </Txt>
            {c.myRank ? (
              <Txt variant="small" color="textMuted">
                You are #{c.myRank}
              </Txt>
            ) : null}
          </View>
          <ProgressBar value={c.target ? c.myProgress / c.target : 0} label={`${c.myProgress} of ${c.target}`} />
        </View>
      ) : (
        <Txt variant="small" color="textMuted">
          Goal: {c.target} {metricUnit(c.metric, c.target)}
        </Txt>
      )}
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Txt variant="small" color="textMuted" style={{ flex: 1 }}>
          {plural(c.participantCount, 'person', 'people')} taking part
        </Txt>
        {c.status !== 'ended' ? (
          <Button label={c.joined ? 'Leave' : 'Join'} variant={c.joined ? 'ghost' : 'primary'} size="md" full={false} loading={busy} onPress={join} testID={`join-${c.id}`} />
        ) : null}
      </View>
    </Card>
  );
}
