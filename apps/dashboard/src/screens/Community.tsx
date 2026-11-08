import { useState, type FormEvent } from 'react';
import {
  CHALLENGE_METRICS,
  addDays,
  challengeSchema,
  dayKey,
  labelOf,
  type Challenge,
  type ChallengeMetric,
  type Comment,
  type Gym,
  type LeaderboardEntry,
  type Post,
} from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDate, formatDateTime, pluralize } from '../lib/format';
import { ROLE_LABELS } from '../lib/roles';
import { validate } from '../lib/validate';
import { Icon } from '../components/Icon';
import { Chip, Empty, ErrorBanner, IconButton, Loading, PageHeader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

// ---------- feed ----------

function Comments({ gym, post, onCountChange }: { gym: Gym; post: Post; onCountChange: (n: number) => void }) {
  const { data, error, loading, setData } = useApiData<{ comments: Comment[] }>(`/gyms/${gym.id}/posts/${post.id}/comments`);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();

  async function remove(c: Comment) {
    if (!window.confirm('Delete this comment?')) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/comments/${c.id}`);
      const next = (data?.comments ?? []).filter((x) => x.id !== c.id);
      setData({ comments: next });
      onCountChange(next.length);
      toast('Comment deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading && !data) return <Loading />;
  const list = data?.comments ?? [];
  return (
    <div className="comments" aria-label={`Comments on ${post.author.name ?? 'post'}'s post`}>
      <ErrorBanner message={error ?? actionError} />
      {list.length === 0 ? (
        <p className="muted small">No comments.</p>
      ) : (
        <ul className="plain-list">
          {list.map((c) => (
            <li key={c.id} className="comment" data-testid="comment">
              <div>
                <strong className="small">{c.author.name ?? 'Member'}</strong>{' '}
                <span className="muted small">{formatDateTime(c.createdAt, gym.timezone)}</span>
                <p className="small pre-wrap">{c.body}</p>
              </div>
              <IconButton icon="trash" tone="danger" label="Delete comment" onClick={() => remove(c)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Feed({ gym }: { gym: Gym }) {
  const { data, error, loading, setData } = useApiData<{ posts: Post[] }>(`/gyms/${gym.id}/posts`);
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(true);
  const [older, setOlder] = useState<'idle' | 'loading' | 'done'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const posts = data?.posts ?? [];
  const visible = showHidden ? posts : posts.filter((p) => !p.hidden);
  const hiddenCount = posts.filter((p) => p.hidden).length;

  const patchPost = (id: string, patch: Partial<Post>) => setData((d) => d && { posts: d.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  async function setHidden(p: Post, hidden: boolean) {
    setActionError(null);
    try {
      const updated = await api.patch<Post>(`/gyms/${gym.id}/posts/${p.id}`, { hidden });
      patchPost(p.id, { ...updated, hidden });
      toast(hidden ? 'Post hidden from members' : 'Post visible again');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function remove(p: Post) {
    if (!window.confirm(`Delete this post by ${p.author.name ?? 'a member'}? This can't be undone.`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/posts/${p.id}`);
      setData((d) => d && { posts: d.posts.filter((x) => x.id !== p.id) });
      toast('Post deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function loadOlder() {
    const last = posts[posts.length - 1];
    if (!last) return;
    setOlder('loading');
    try {
      const res = await api.get<{ posts: Post[] }>(`/gyms/${gym.id}/posts?before=${encodeURIComponent(last.createdAt)}`);
      setData((d) => ({ posts: [...(d?.posts ?? []), ...res.posts] }));
      setOlder(res.posts.length < 20 ? 'done' : 'idle');
    } catch (err) {
      setActionError(errorMessage(err));
      setOlder('idle');
    }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="checkbox">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden posts ({hiddenCount})
        </label>
      </div>
      <ErrorBanner message={error ?? actionError} />
      {loading && !data ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Empty icon="chat">No posts yet. Members' posts show up here for moderation.</Empty>
      ) : (
        <ul className="plain-list stack">
          {visible.map((p) => (
            <li key={p.id} className={`card post${p.hidden ? ' is-hidden' : ''}`} data-testid="post">
              <div className="post-head">
                <span className="user-dot" aria-hidden>
                  {(p.author.name ?? 'M').trim()[0]?.toUpperCase()}
                </span>
                <div className="post-who">
                  <strong>{p.author.name ?? 'Member'}</strong>
                  <span className="muted small">
                    {p.author.role !== 'member' && `${ROLE_LABELS[p.author.role]} · `}
                    {formatDateTime(p.createdAt, gym.timezone)}
                  </span>
                </div>
                {p.hidden && <Chip tone="warning">Hidden</Chip>}
              </div>
              <p className="pre-wrap">{p.body}</p>
              <div className="post-foot">
                <span className="muted small">
                  <Icon name="heart" size={14} /> {p.likeCount} · {pluralize(p.commentCount, 'comment')}
                </span>
                <div className="card-actions">
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    {open === p.id ? 'Hide comments' : 'Comments'}
                  </button>
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setHidden(p, !p.hidden)}>
                    <Icon name={p.hidden ? 'eye' : 'eyeOff'} size={16} /> {p.hidden ? 'Unhide' : 'Hide'}
                  </button>
                  <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(p)}>
                    Delete
                  </button>
                </div>
              </div>
              {open === p.id && <Comments gym={gym} post={p} onCountChange={(n) => patchPost(p.id, { commentCount: n })} />}
            </li>
          ))}
        </ul>
      )}
      {posts.length >= 20 && older !== 'done' && (
        <div className="center">
          <button type="button" className="btn btn-secondary" onClick={loadOlder} disabled={older === 'loading'}>
            {older === 'loading' ? 'Loading…' : 'Load older posts'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- challenges ----------

function ChallengeForm({ gym, onCreated, onCancel }: { gym: Gym; onCreated: (c: Challenge) => void; onCancel: () => void }) {
  const today = dayKey(new Date(), gym.timezone);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [metric, setMetric] = useState<ChallengeMetric>('checkins');
  const [target, setTarget] = useState('12');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(addDays(today, 27));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(challengeSchema, { title, description, metric, target: Number(target), startsOn, endsOn });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post<Challenge>(`/gyms/${gym.id}/challenges`, parsed.data));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label="New challenge">
      <h2>New challenge</h2>
      <div className="form-grid">
        <label className="field span-4">
          <span>Challenge title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="November 12-visit challenge" />
        </label>
        <label className="field span-4">
          <span>Description</span>
          <textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span>Metric</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as ChallengeMetric)}>
            {CHALLENGE_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Target</span>
          <input type="number" min={1} max={1000} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="field">
          <span>Starts on</span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </label>
        <label className="field">
          <span>Ends on</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
      </div>
      <small className="muted">Members get a notification. Progress counts {labelOf(CHALLENGE_METRICS, metric).toLowerCase()} between the two dates.</small>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create challenge'}
        </button>
      </div>
    </form>
  );
}

function Leaderboard({ gym, challenge }: { gym: Gym; challenge: Challenge }) {
  const { data, error, loading } = useApiData<{ entries: LeaderboardEntry[] }>(`/gyms/${gym.id}/challenges/${challenge.id}/leaderboard`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner message={error} />;
  const entries = data?.entries ?? [];
  if (entries.length === 0) return <p className="muted small">Nobody has joined yet.</p>;
  return (
    <ol className="leaderboard" aria-label={`Leaderboard for ${challenge.title}`}>
      {entries.map((e) => (
        <li key={e.user.id} data-testid="leader">
          <span className={`rank${e.rank <= 3 ? ' rank-top' : ''}`}>{e.rank}</span>
          <span className="leader-name">{e.user.name ?? 'Member'}</span>
          <span className="leader-bar" aria-hidden>
            <b style={{ width: `${Math.min(100, (e.progress / challenge.target) * 100)}%` }} />
          </span>
          <span className="leader-score">
            {e.progress}/{challenge.target}
          </span>
          {e.completed && <Chip tone="success">Done</Chip>}
        </li>
      ))}
    </ol>
  );
}

const STATUS_TONE = { active: 'success', upcoming: 'brand', ended: 'muted' } as const;

function Challenges({ gym, adding, setAdding }: { gym: Gym; adding: boolean; setAdding: (v: boolean) => void }) {
  const { data, error, loading, setData } = useApiData<{ challenges: Challenge[] }>(`/gyms/${gym.id}/challenges`);
  const [open, setOpen] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const list = data?.challenges ?? [];

  async function remove(c: Challenge) {
    if (!window.confirm(`Delete "${c.title}"? Its leaderboard will be lost.`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/challenges/${c.id}`);
      setData((d) => d && { challenges: d.challenges.filter((x) => x.id !== c.id) });
      toast('Challenge deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      {adding && (
        <ChallengeForm
          gym={gym}
          onCancel={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false);
            toast('Challenge created');
            setData((d) => ({ challenges: [c, ...(d?.challenges ?? [])] }));
          }}
        />
      )}
      <ErrorBanner message={error ?? actionError} />
      {loading && !data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon="trophy">No challenges yet. A monthly visit challenge is a great start.</Empty>
      ) : (
        <ul className="plain-list stack">
          {list.map((c) => (
            <li key={c.id} className="card stack-sm" data-testid="challenge">
              <div className="section-head">
                <div>
                  <h3>{c.title}</h3>
                  <span className="muted small">
                    {labelOf(CHALLENGE_METRICS, c.metric)} · target {c.target} · {formatDate(`${c.startsOn}T12:00:00Z`, 'UTC')} –{' '}
                    {formatDate(`${c.endsOn}T12:00:00Z`, 'UTC')}
                  </span>
                </div>
                <Chip tone={STATUS_TONE[c.status]}>{c.status === 'active' ? 'Active' : c.status === 'upcoming' ? 'Upcoming' : 'Ended'}</Chip>
              </div>
              {c.description && <p className="small">{c.description}</p>}
              <div className="post-foot">
                <span className="muted small">{pluralize(c.participantCount, 'participant')}</span>
                <div className="card-actions">
                  <button type="button" className="btn btn-small btn-secondary" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <Icon name="trophy" size={16} /> {open === c.id ? 'Hide leaderboard' : 'Leaderboard'}
                  </button>
                  <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(c)}>
                    Delete
                  </button>
                </div>
              </div>
              {open === c.id && <Leaderboard gym={gym} challenge={c} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Community({ gym }: { gym: Gym }) {
  const [tab, setTab] = useState<'feed' | 'challenges'>('feed');
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack-lg">
      <PageHeader
        title="Community"
        subtitle="Moderate the member feed and run challenges with leaderboards."
        actions={
          tab === 'challenges' &&
          !adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={18} /> New challenge
            </button>
          )
        }
      />
      <Tabs
        label="Community"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setAdding(false);
        }}
        tabs={[
          { id: 'feed', label: 'Feed' },
          { id: 'challenges', label: 'Challenges' },
        ]}
      />
      {tab === 'feed' ? <Feed gym={gym} /> : <Challenges gym={gym} adding={adding} setAdding={setAdding} />}
    </div>
  );
}
