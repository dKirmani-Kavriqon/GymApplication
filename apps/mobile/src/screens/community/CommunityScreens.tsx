import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { commentSchema, postSchema, type Challenge, type Comment, type Post } from '@gymverse/shared';
import { Avatar, Button, Card, EmptyState, ErrorText, Field, Pill, ProgressBar, Screen, Segmented, Stat, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { formatDate } from '../../utils/format';
import { useLoad } from '../../utils/useLoad';
import { Gate, InlineConfirm, emit, timeAgo, useBus, useGymApi } from '../train/common';
import { ChallengeCard, PostCard, challengeWhen, metricLabel, metricUnit, useJoinToggle } from './parts';
import type { ScreenProps } from '../../navigation/featureRoutes';

const PAGE = 20;

// ---------- Community tab ----------

type Seg = 'feed' | 'challenges';

/** Root of the Community tab: the gym feed and challenges. */
export function CommunityTab() {
  const [seg, setSeg] = useState<Seg>('feed');
  const feed = useFeed();
  const challenges = useChallenges(seg === 'challenges');
  const refresh = seg === 'feed' ? feed.reload : challenges.reload;
  const refreshing = seg === 'feed' ? feed.loading && !!feed.data : challenges.loading && !!challenges.data;
  return (
    <Screen title="Community" testID="community-tab" refreshing={refreshing} onRefresh={refresh}>
      <Segmented<Seg>
        options={[
          { id: 'feed', label: 'Feed' },
          { id: 'challenges', label: 'Challenges' },
        ]}
        value={seg}
        onChange={setSeg}
      />
      {seg === 'feed' ? <FeedView feed={feed} /> : <ChallengesView list={challenges} />}
    </Screen>
  );
}

function useFeed() {
  const { api, gymId } = useGymApi();
  const [lastPage, setLastPage] = useState(0);
  const load = useLoad(async () => {
    const res = await api.posts(gymId);
    setLastPage(res.posts.length);
    return res.posts;
  }, gymId);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const { setData } = load;

  useBus('post:created', (p) => setData((list) => (list ? [p as Post, ...list.filter((x) => x.id !== (p as Post).id)] : list)));
  useBus('post:updated', (p) => setData((list) => (list ? list.map((x) => (x.id === (p as Post).id ? (p as Post) : x)) : list)));
  useBus('post:deleted', (id) => setData((list) => (list ? list.filter((x) => x.id !== id) : list)));

  async function loadMore() {
    const list = load.data ?? [];
    if (!list.length) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await api.posts(gymId, list[list.length - 1].createdAt);
      setLastPage(res.posts.length);
      setData((cur) => {
        const have = new Set((cur ?? []).map((p) => p.id));
        return [...(cur ?? []), ...res.posts.filter((p) => !have.has(p.id))];
      });
    } catch (err) {
      setMoreError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return { ...load, hasMore: lastPage >= PAGE, loadMore, loadingMore, moreError };
}

function FeedView({ feed }: { feed: ReturnType<typeof useFeed> }) {
  const nav = useNav();
  const { me } = useGymApi();
  const t = useTheme();
  const replace = (p: Post) => feed.setData((list) => (list ? list.map((x) => (x.id === p.id ? p : x)) : list));
  const remove = (id: string) => feed.setData((list) => (list ? list.filter((x) => x.id !== id) : list));

  return (
    <>
      <Card onPress={() => nav.push('NewPost')} accessibilityLabel="Write a post" testID="composer">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={me?.user.name} size={40} />
          <Txt color="textMuted" style={{ flex: 1 }}>
            Share something with the gym…
          </Txt>
          <Icon name="edit-3" size={20} color={t.primaryText} />
        </View>
      </Card>
      <Gate loading={feed.loading} error={feed.error} ready={!!feed.data} onRetry={feed.reload}>
        {() =>
          feed.data!.length === 0 ? (
            <EmptyState icon="message-circle" title="No posts yet" body="Be the first to say hello to the gym." actionLabel="Write a post" onAction={() => nav.push('NewPost')} />
          ) : (
            <View style={{ gap: 12 }}>
              {feed.data!.map((p, i) => (
                <PostCard key={p.id} index={i} post={p} onChange={replace} onDeleted={remove} onOpen={() => nav.push('Post', { id: p.id, post: p })} />
              ))}
              <ErrorText message={feed.moreError} />
              {feed.hasMore ? <Button label="Load more" variant="soft" onPress={feed.loadMore} loading={feed.loadingMore} testID="load-more" /> : null}
            </View>
          )
        }
      </Gate>
    </>
  );
}

function useChallenges(active: boolean) {
  const { api, gymId } = useGymApi();
  const load = useLoad(() => (active ? api.challenges(gymId).then((r) => r.challenges) : Promise.resolve(null)), `${gymId}|${active}`);
  const { setData } = load;
  useBus('challenges:changed', (c) => setData((list) => (list ? list.map((x) => (x.id === (c as Challenge).id ? (c as Challenge) : x)) : list)));
  return load;
}

function ChallengesView({ list }: { list: ReturnType<typeof useChallenges> }) {
  const nav = useNav();
  const replace = (c: Challenge) => list.setData((cur) => (cur ? cur.map((x) => (x.id === c.id ? c : x)) : cur));
  return (
    <Gate loading={list.loading} error={list.error} ready={!!list.data} onRetry={list.reload}>
      {() =>
        list.data!.length === 0 ? (
          <EmptyState icon="flag" title="No challenges right now" body="When your gym starts a challenge, you can join it here." />
        ) : (
          <View style={{ gap: 12 }}>
            {list.data!.map((c, i) => (
              <ChallengeCard key={c.id} index={i} challenge={c} onChange={replace} onPress={() => nav.push('ChallengeDetail', { id: c.id })} />
            ))}
          </View>
        )
      }
    </Gate>
  );
}

// ---------- Post ----------

/** One post with its comments. The feed passes `post`; a notification link passes only `id`. */
export function PostScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const toast = useToast();
  const [post, setPost] = useState<Post | null>((params.post as Post | undefined) ?? null);
  const [postError, setPostError] = useState<string | null>(null);
  const [postLoading, setPostLoading] = useState(!params.post);
  const comments = useLoad(() => api.comments(gymId, id).then((r) => [...r.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))), `${gymId}|${id}`);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function loadPost() {
    setPostLoading(true);
    setPostError(null);
    try {
      const res = await api.posts(gymId);
      const found = res.posts.find((p) => p.id === id);
      if (found) setPost(found);
      else setPostError('This post is no longer available.');
    } catch (err) {
      setPostError((err as Error).message);
    } finally {
      setPostLoading(false);
    }
  }
  useEffect(() => {
    if (!params.post) void loadPost();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updatePost(next: Post) {
    setPost(next);
    emit('post:updated', next);
  }

  async function send() {
    const parsed = commentSchema.safeParse({ body: text });
    if (!parsed.success) {
      setSendError(text.trim() ? 'Comments can be up to 500 characters.' : 'Write something first.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const c = await api.addComment(gymId, id, parsed.data.body);
      comments.setData((list) => [...(list ?? []), c]);
      setText('');
      if (post) updatePost({ ...post, commentCount: post.commentCount + 1 });
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function removed(commentId: string) {
    comments.setData((list) => (list ? list.filter((c) => c.id !== commentId) : list));
    if (post) updatePost({ ...post, commentCount: Math.max(0, post.commentCount - 1) });
    toast.show({ title: 'Comment deleted' });
  }

  return (
    <Screen title="Post" onBack={nav.pop}>
      <Gate loading={postLoading} error={postError} ready={!!post} onRetry={loadPost}>
        {() => (
          <>
            <PostCard
              post={post!}
              onChange={setPost}
              onDeleted={() => {
                toast.show({ title: 'Post deleted' });
                nav.pop();
              }}
            />
            <Txt variant="h3" color="heading" accessibilityRole="header">
              Comments
            </Txt>
            <Gate loading={comments.loading} error={comments.error} ready={!!comments.data} onRetry={comments.reload}>
              {() =>
                comments.data!.length === 0 ? (
                  <Txt color="textMuted">No comments yet. Say something nice!</Txt>
                ) : (
                  <View style={{ gap: 10 }}>
                    {comments.data!.map((c) => (
                      <CommentRow key={c.id} comment={c} onDeleted={() => removed(c.id)} />
                    ))}
                  </View>
                )
              }
            </Gate>
            <Card style={{ gap: 10 }}>
              <Field label="Add a comment" value={text} onChangeText={setText} placeholder="Write a comment" multiline maxLength={500} error={sendError} />
              <Button label="Send comment" icon="send" onPress={send} loading={sending} size="md" testID="send-comment" />
            </Card>
          </>
        )}
      </Gate>
    </Screen>
  );
}

function CommentRow({ comment, onDeleted }: { comment: Comment; onDeleted: () => void }) {
  const { api, gymId } = useGymApi();
  const t = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = comment.author.name ?? 'Member';

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteComment(gymId, comment.id);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <View testID={`comment-${comment.id}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Avatar name={name} size={36} />
        <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: t.radius.md, padding: 12, borderWidth: 1, borderColor: t.border, gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Txt variant="smallStrong">{comment.mine ? `${name} (you)` : name}</Txt>
            <Txt variant="small" color="textMuted">
              {timeAgo(comment.createdAt)}
            </Txt>
          </View>
          <Txt>{comment.body}</Txt>
          {comment.mine && !confirming ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Delete your comment" onPress={() => setConfirming(true)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
              <Icon name="trash-2" size={16} color={t.danger} />
              <Txt variant="smallStrong" color="danger">
                Delete
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </View>
      {confirming ? (
        <InlineConfirm message="Delete this comment?" confirmLabel="Delete" cancelLabel="Keep it" busy={busy} error={error} onConfirm={remove} onCancel={() => setConfirming(false)} testID="confirm-delete-comment" />
      ) : null}
    </View>
  );
}

// ---------- New post ----------

export function NewPostScreen() {
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = postSchema.safeParse({ body });
    if (!parsed.success) {
      setError(body.trim() ? 'Posts can be up to 1000 characters.' : 'Write something first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const post = await api.createPost(gymId, parsed.data.body);
      emit('post:created', post);
      toast.show({ title: 'Posted', body: 'Your post is in the feed.' });
      nav.pop();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen title="New post" onBack={nav.pop} footer={<Button label="Post" icon="send" onPress={submit} loading={busy} testID="submit-post" />}>
      <Field label="Your post" value={body} onChangeText={setBody} placeholder="Share a win, ask a question, cheer someone on…" multiline maxLength={1000} error={error} autoFocus />
      <Txt variant="small" color="textMuted" align="right">
        {body.length} / 1000
      </Txt>
      <Txt variant="small" color="textMuted">
        Everyone at your gym can see this. Be kind.
      </Txt>
    </Screen>
  );
}

// ---------- Challenge detail ----------

export function ChallengeDetailScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const nav = useNav();
  const t = useTheme();
  const toast = useToast();
  const { api, gymId } = useGymApi();
  const toggle = useJoinToggle();
  const ch = useLoad(async () => {
    const res = await api.challenges(gymId);
    const found = res.challenges.find((c) => c.id === id);
    if (!found) throw new Error('This challenge is no longer available.');
    return found;
  }, `${gymId}|${id}`);
  const [version, setVersion] = useState(0);
  const board = useLoad(() => api.leaderboard(gymId, id).then((r) => r.entries), `${gymId}|${id}|${version}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!ch.data) return;
    setBusy(true);
    setError(null);
    try {
      const next = await toggle(ch.data);
      ch.setData(next);
      setVersion((v) => v + 1);
      toast.show({ title: next.joined ? 'You joined the challenge' : 'You left the challenge', body: next.title });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const c = ch.data;
  return (
    <Screen
      title="Challenge"
      onBack={nav.pop}
      footer={
        c && c.status !== 'ended' ? (
          <>
            <ErrorText message={error} />
            <Button label={c.joined ? 'Leave challenge' : 'Join challenge'} variant={c.joined ? 'outline' : 'primary'} arrow={!c.joined} onPress={join} loading={busy} testID="join-challenge" />
          </>
        ) : undefined
      }
    >
      <Gate loading={ch.loading} error={ch.error} ready={!!c} onRetry={ch.reload}>
        {() => (
          <>
            <Card variant="tint" style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Pill label={metricLabel(c!.metric)} tone="primary" />
                <Pill label={challengeWhen(c!)} />
                {c!.joined ? <Pill label="Joined" tone="success" /> : null}
              </View>
              <Txt variant="h1" color="heading" accessibilityRole="header">
                {c!.title}
              </Txt>
              {c!.description ? <Txt>{c!.description}</Txt> : null}
              <Txt variant="small" color="textMuted">
                {formatDay(c!.startsOn)} – {formatDay(c!.endsOn)}
              </Txt>
              {c!.joined ? (
                <View style={{ gap: 8 }} testID="my-progress">
                  <Txt variant="number" color="heading">
                    {c!.myProgress}
                    <Txt variant="h3" color="textMuted">
                      {' '}
                      / {c!.target} {metricUnit(c!.metric, c!.target)}
                    </Txt>
                  </Txt>
                  <ProgressBar value={c!.target ? c!.myProgress / c!.target : 0} label={`Your progress: ${c!.myProgress} of ${c!.target}`} />
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Stat value={c!.target} label={`${metricUnit(c!.metric, c!.target)} to reach`} icon="target" />
                <Stat value={c!.participantCount} label={c!.participantCount === 1 ? 'person' : 'people'} icon="users" />
                {c!.myRank ? <Stat value={`#${c!.myRank}`} label="your rank" icon="award" /> : null}
              </View>
            </Card>

            <Txt variant="h3" color="heading" accessibilityRole="header">
              Leaderboard
            </Txt>
            <Gate loading={board.loading} error={board.error} ready={!!board.data} onRetry={board.reload}>
              {() =>
                board.data!.length === 0 ? (
                  <Txt color="textMuted">Nobody has joined yet. Be the first!</Txt>
                ) : (
                  <Card style={{ gap: 4, paddingVertical: 8 }}>
                    {board.data!.map((e) => (
                      <View
                        key={e.user.id}
                        testID={e.isMe ? 'leader-me' : `leader-${e.user.id}`}
                        accessibilityLabel={`Rank ${e.rank}, ${e.isMe ? 'you' : e.user.name ?? 'Member'}, ${e.progress} ${metricUnit(c!.metric, e.progress)}${e.completed ? ', completed' : ''}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 10, borderRadius: t.radius.md, backgroundColor: e.isMe ? t.tint : 'transparent' }}
                      >
                        <Txt variant="h3" color={e.rank <= 3 ? 'primaryText' : 'textMuted'} style={{ width: 32 }}>
                          {e.rank}
                        </Txt>
                        <Avatar name={e.user.name} size={34} />
                        <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                          {e.isMe ? `${e.user.name ?? 'You'} (you)` : e.user.name ?? 'Member'}
                        </Txt>
                        <Txt variant="bodyStrong" color="heading">
                          {e.progress}
                        </Txt>
                        {e.completed ? <Icon name="check-circle" size={20} color={t.success} /> : <View style={{ width: 20 }} />}
                      </View>
                    ))}
                  </Card>
                )
              }
            </Gate>
            <Txt variant="small" color="textMuted">
              Counts your {metricUnit(c!.metric, 2)} from the start date to the end date. People who hide their stats show as “Member”.
            </Txt>
          </>
        )}
      </Gate>
    </Screen>
  );
}

function formatDay(day: string) {
  return formatDate(`${day}T12:00:00`);
}
