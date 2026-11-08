import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { humanize, type Article, type ArticleKind } from '@gymverse/shared';
import { Button, Card, Chip, EmptyState, ErrorText, IconTile, ListRow, Pill, Screen, Txt } from '../../components/ui';
import type { IconName } from '../../components/Icon';
import { useNav } from '../../navigation/Nav';
import { formatDate } from '../../utils/format';
import { useLoad } from '../../utils/useLoad';
import { FavouriteButton, Gate, bigNumber, plural, useBus, useGymApi } from '../train/common';
import type { ScreenProps } from '../../navigation/featureRoutes';

export const KIND_ICON: Record<ArticleKind, IconName> = { article: 'file-text', video: 'play-circle', tip: 'zap' };
const KIND_LABEL: Record<ArticleKind, string> = { article: 'Article', video: 'Video', tip: 'Tip' };

const FILTERS: Array<{ id: ArticleKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'article', label: 'Articles' },
  { id: 'video', label: 'Videos' },
  { id: 'tip', label: 'Tips' },
];

function readTime(a: Article) {
  return a.kind === 'video' ? 'Video' : `${a.readMinutes} min read`;
}

// ---------- list ----------

export function ResourcesScreen({ params }: ScreenProps) {
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const initial = (['article', 'video', 'tip'] as const).find((k) => k === params.kind) ?? 'all';
  const [kind, setKind] = useState<ArticleKind | 'all'>(initial);
  const { data, error, loading, reload } = useLoad(() => api.articles(gymId, kind === 'all' ? undefined : kind), `${gymId}|${kind}`);

  return (
    <Screen title="Learn" onBack={nav.pop} refreshing={loading && !!data} onRefresh={reload}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} icon={f.id === 'all' ? 'grid' : KIND_ICON[f.id]} selected={kind === f.id} onPress={() => setKind(f.id)} />
        ))}
      </ScrollView>
      <Gate loading={loading} error={error} ready={!!data && !loading} onRetry={reload}>
        {() =>
          data!.articles.length === 0 ? (
            <EmptyState icon="book-open" title="Nothing here yet" body="Your gym has not shared anything in this section. Check back soon." />
          ) : (
            <View style={{ gap: 12 }}>
              {data!.articles.map((a, i) => (
                <Card key={a.id} index={i} onPress={() => nav.push('Article', { id: a.id })} accessibilityLabel={`${KIND_LABEL[a.kind]}: ${a.title}. ${readTime(a)}`} testID={`article-${a.id}`}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                    <IconTile icon={KIND_ICON[a.kind]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="caption" color="textMuted">
                        {KIND_LABEL[a.kind]} · {readTime(a)}
                      </Txt>
                      <Txt variant="bodyStrong">{a.title}</Txt>
                      {a.summary ? (
                        <Txt variant="small" color="textMuted" numberOfLines={2}>
                          {a.summary}
                        </Txt>
                      ) : null}
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )
        }
      </Gate>
    </Screen>
  );
}

// ---------- article ----------

export function ArticleScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const { data, error, loading, reload } = useLoad(() => api.article(gymId, id), `${gymId}|${id}`);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function watch(url: string) {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('Could not open the video. Please try again later.');
    }
  }

  return (
    <Screen
      title={data ? KIND_LABEL[data.kind] : 'Article'}
      onBack={nav.pop}
      right={data ? <FavouriteButton kind="article" id={data.id} value={data.favourite} name={data.title} /> : undefined}
      footer={data?.videoUrl ? <Button label="Watch video" icon="play" onPress={() => watch(data.videoUrl!)} testID="watch-video" /> : undefined}
    >
      <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
        {() => {
          const a = data!;
          const paragraphs = a.body
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean);
          return (
            <>
              <View style={{ gap: 8 }}>
                <Txt variant="h1" color="heading" accessibilityRole="header">
                  {a.title}
                </Txt>
                <Txt variant="small" color="textMuted">
                  {a.author.name ? `By ${a.author.name} · ` : ''}
                  {readTime(a)} · {formatDate(a.publishedAt)}
                </Txt>
                {a.tags.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {a.tags.map((tag) => (
                      <Pill key={tag} label={tag} />
                    ))}
                  </View>
                ) : null}
              </View>
              {a.summary ? (
                <Card variant="tint">
                  <Txt variant="bodyStrong">{a.summary}</Txt>
                </Card>
              ) : null}
              {paragraphs.map((p, i) => (
                <Txt key={i} style={{ fontSize: 16, lineHeight: 25 }}>
                  {p}
                </Txt>
              ))}
              <ErrorText message={linkError} />
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}

// ---------- favourites ----------

export function FavouritesScreen() {
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const { data, error, loading, reload } = useLoad(() => api.favourites(gymId), gymId);
  useBus('favourites:changed', () => void reload());

  return (
    <Screen title="Favourites" onBack={nav.pop} refreshing={loading && !!data} onRefresh={reload}>
      <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
        {() => {
          const f = data!;
          const empty = !f.routines.length && !f.articles.length && !f.mealIdeas.length && !f.mealPlans.length;
          if (empty) {
            return <EmptyState icon="heart" title="Nothing saved yet" body="Tap the heart on a routine, article or recipe to keep it here." />;
          }
          return (
            <>
              {f.routines.length ? (
                <Section title="Routines">
                  {f.routines.map((r) => (
                    <ListRow key={r.id} icon="activity" title={r.name} subtitle={`${humanize(r.level)} · ~${r.durationMin} min · ${plural(r.exercises.length, 'exercise')}`} onPress={() => nav.push('RoutineDetail', { id: r.id })} />
                  ))}
                </Section>
              ) : null}
              {f.articles.length ? (
                <Section title="Articles">
                  {f.articles.map((a) => (
                    <ListRow key={a.id} icon={KIND_ICON[a.kind]} title={a.title} subtitle={readTime(a)} onPress={() => nav.push('Article', { id: a.id })} />
                  ))}
                </Section>
              ) : null}
              {f.mealIdeas.length ? (
                <Section title="Recipes">
                  {f.mealIdeas.map((m) => (
                    <ListRow key={m.id} icon="coffee" title={m.title} subtitle={`${bigNumber(m.calories)} kcal · ${Math.round(m.proteinG)} g protein`} onPress={() => nav.push('MealIdea', { id: m.id })} />
                  ))}
                </Section>
              ) : null}
              {f.mealPlans.length ? (
                <Section title="Meal plans">
                  {f.mealPlans.map((p) => (
                    <ListRow key={p.id} icon="book-open" title={p.title} subtitle={`${bigNumber(p.caloriesPerDay)} kcal a day`} onPress={() => nav.push('MealPlan', { id: p.id })} />
                  ))}
                </Section>
              ) : null}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="h3" color="heading" accessibilityRole="header">
        {title}
      </Txt>
      <Card style={{ paddingVertical: 6, gap: 0 }}>{children}</Card>
    </View>
  );
}
