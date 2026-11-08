import { useState, type FormEvent } from 'react';
import { ARTICLE_KINDS, articleSchema, type Article, type ArticleKind, type Gym } from '@gymverse/shared';
import { api, errorMessage } from '../lib/api';
import { useApiData } from '../lib/useApi';
import { formatDate } from '../lib/format';
import { emptyToNull, splitList, validate } from '../lib/validate';
import { Icon, type IconName } from '../components/Icon';
import { Chip, Empty, ErrorBanner, Loading, PageHeader, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';

const KIND_ICON: Record<ArticleKind, IconName> = { article: 'book', video: 'video', tip: 'bulb' };
const KIND_LABEL: Record<ArticleKind, string> = { article: 'Article', video: 'Video', tip: 'Tip' };

function ArticleForm({
  gym,
  article,
  onSaved,
  onCancel,
}: {
  gym: Gym;
  article: Article | null;
  onSaved: (a: Article, created: boolean) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ArticleKind>(article?.kind ?? 'article');
  const [title, setTitle] = useState(article?.title ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [tags, setTags] = useState((article?.tags ?? []).join(', '));
  const [imageUrl, setImageUrl] = useState(article?.imageUrl ?? '');
  const [videoUrl, setVideoUrl] = useState(article?.videoUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = validate(articleSchema, {
      kind,
      title,
      summary,
      body,
      tags: splitList(tags, /,/),
      imageUrl: emptyToNull(imageUrl),
      videoUrl: emptyToNull(videoUrl),
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (kind === 'video' && !parsed.data.videoUrl) {
      setError('Add the video URL for a video.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = article
        ? await api.patch<Article>(`/gyms/${gym.id}/articles/${article.id}`, parsed.data)
        : await api.post<Article>(`/gyms/${gym.id}/articles`, parsed.data);
      onSaved(saved, !article);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={article ? 'Edit resource' : 'New resource'}>
      <h2>{article ? 'Edit resource' : 'New resource'}</h2>
      <div className="segmented" role="radiogroup" aria-label="Type">
        {ARTICLE_KINDS.map((k) => (
          <label key={k} className={kind === k ? 'is-active' : ''}>
            <input type="radio" name="article-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </div>
      <div className="form-grid">
        <label className="field span-4">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="How to warm up properly" />
        </label>
        <label className="field span-4">
          <span>Summary</span>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={240} placeholder="One line shown in the list" />
        </label>
        <label className="field span-4">
          <span>Body</span>
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
        </label>
        <label className="field span-2">
          <span>Tags (comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="mobility, beginners" />
        </label>
        <label className="field span-2">
          <span>Image URL</span>
          <input inputMode="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field span-4">
          <span>Video URL</span>
          <input inputMode="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/…" />
        </label>
      </div>
      <ErrorBanner message={error} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : article ? 'Save changes' : 'Publish'}
        </button>
      </div>
    </form>
  );
}

export function Resources({ gym }: { gym: Gym }) {
  const { data, error, loading, setData } = useApiData<{ articles: Article[] }>(`/gyms/${gym.id}/articles`);
  const [filter, setFilter] = useState<ArticleKind | 'all'>('all');
  const [editing, setEditing] = useState<Article | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  const all = data?.articles ?? [];
  const list = filter === 'all' ? all : all.filter((a) => a.kind === filter);

  async function remove(a: Article) {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    setActionError(null);
    try {
      await api.del(`/gyms/${gym.id}/articles/${a.id}`);
      setData((d) => d && { articles: d.articles.filter((x) => x.id !== a.id) });
      toast('Resource deleted');
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Resources"
        subtitle="Articles, videos and quick tips your members can read and save."
        actions={
          editing === null && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={18} /> New resource
            </button>
          )
        }
      />
      {editing !== null && (
        <ArticleForm
          key={editing === 'new' ? 'new' : editing.id}
          gym={gym}
          article={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(a, created) => {
            setEditing(null);
            toast(created ? 'Resource published' : 'Resource saved');
            setData((d) => ({ articles: created ? [a, ...(d?.articles ?? [])] : (d?.articles ?? []).map((x) => (x.id === a.id ? a : x)) }));
          }}
        />
      )}
      <Tabs
        label="Filter resources"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All', count: all.length },
          ...ARTICLE_KINDS.map((k) => ({ id: k, label: `${KIND_LABEL[k]}s`, count: all.filter((a) => a.kind === k).length })),
        ]}
      />
      <ErrorBanner message={error ?? actionError} />
      {loading && !data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon="book">{all.length === 0 ? 'Nothing published yet. Share your first tip with members.' : 'Nothing of this type yet.'}</Empty>
      ) : (
        <div className="resource-grid">
          {list.map((a) => (
            <article key={a.id} className="card resource-card" data-testid="resource">
              {a.imageUrl ? (
                <img className="resource-img" src={a.imageUrl} alt="" />
              ) : (
                <div className="resource-img resource-img-empty" aria-hidden>
                  <Icon name={KIND_ICON[a.kind]} size={28} />
                </div>
              )}
              <div className="resource-body">
                <div className="resource-meta">
                  <Chip tone="brand">{KIND_LABEL[a.kind]}</Chip>
                  <span className="muted small">
                    {a.readMinutes} min · {formatDate(a.publishedAt, gym.timezone)}
                  </span>
                </div>
                <h3>{a.title}</h3>
                {a.summary && <p className="muted small">{a.summary}</p>}
                {a.tags.length > 0 && (
                  <div className="chip-row">
                    {a.tags.map((t) => (
                      <span key={t} className="tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="card-actions">
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setEditing(a)} aria-label={`Edit ${a.title}`}>
                    <Icon name="edit" size={16} /> Edit
                  </button>
                  <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => remove(a)} aria-label={`Delete ${a.title}`}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
