import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { humanize, type SearchResults } from '@gymverse/shared';
import { Card, EmptyState, ErrorText, IconButton, ListRow, Skeleton, Screen, Txt } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useSession } from '../../state/session';
import { useGym } from '../../state/hooks';
import { useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { TYPE } from '../../theme/type';
import { formatClassTime } from '../../utils/format';

/** Search everything in the gym: classes, workouts, exercises, articles, recipes, trainers (FitBody gap). */
export function SearchScreen({ debounceMs = 300 }: { debounceMs?: number }) {
  const { api } = useSession();
  const gym = useGym();
  const nav = useNav();
  const t = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.search(gym.id, query);
        if (id === reqId.current) setResults(res);
      } catch (err) {
        if (id === reqId.current) setError((err as Error).message);
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [q, api, gym.id, debounceMs]);

  const total = results
    ? results.classes.length + results.routines.length + results.exercises.length + results.articles.length + results.mealIdeas.length + results.trainers.length
    : 0;

  return (
    <Screen testID="search">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconButton icon="arrow-left" label="Back" onPress={nav.pop} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: 999, backgroundColor: t.surfaceAlt, paddingHorizontal: 18 }}>
          <Icon name="search" size={18} color={t.textMuted} />
          <TextInput
            autoFocus
            accessibilityLabel="Search"
            placeholder="Classes, workouts, recipes…"
            placeholderTextColor={t.textMuted}
            value={q}
            onChangeText={setQ}
            returnKeyType="search"
            style={[TYPE.body, { flex: 1, color: t.text, fontSize: 16 }]}
          />
        </View>
      </View>

      {q.trim().length < 2 ? (
        <Txt variant="body" color="textMuted">
          Type at least 2 letters to search classes, workouts, exercises, articles, recipes and trainers.
        </Txt>
      ) : busy && !results ? (
        <Skeleton label="Searching" rows={2} />
      ) : error ? (
        <ErrorText message={error} />
      ) : results && total === 0 ? (
        <EmptyState icon="search" title={`Nothing for “${results.query}”`} body="Try a shorter word, like 'yoga' or 'paneer'." />
      ) : results ? (
        <>
          <Group title="Classes" count={results.classes.length}>
            {results.classes.map((c) => (
              <ListRow key={c.id} icon="calendar" title={c.title} subtitle={`${formatClassTime(c.startsAt, new Date())}${c.trainerName ? ` · ${c.trainerName}` : ''}`} onPress={() => nav.setTab('classes')} />
            ))}
          </Group>
          <Group title="Workouts" count={results.routines.length}>
            {results.routines.map((r) => (
              <ListRow key={r.id} icon="activity" title={r.name} subtitle={`${humanize(r.level)} · ~${r.durationMin} min`} onPress={() => nav.push('RoutineDetail', { id: r.id })} />
            ))}
          </Group>
          <Group title="Exercises" count={results.exercises.length}>
            {results.exercises.map((e) => (
              <ListRow key={e.id} icon="target" title={e.name} subtitle={`${humanize(e.muscleGroup)} · ${humanize(e.equipment)}`} />
            ))}
          </Group>
          <Group title="Articles & videos" count={results.articles.length}>
            {results.articles.map((a) => (
              <ListRow key={a.id} icon={a.kind === 'video' ? 'play-circle' : 'book-open'} title={a.title} subtitle={a.summary} onPress={() => nav.push('Article', { id: a.id })} />
            ))}
          </Group>
          <Group title="Recipes" count={results.mealIdeas.length}>
            {results.mealIdeas.map((m) => (
              <ListRow key={m.id} icon="coffee" title={m.title} subtitle={`${m.calories} kcal · ${m.proteinG} g protein`} onPress={() => nav.push('MealIdea', { id: m.id })} />
            ))}
          </Group>
          <Group title="Trainers" count={results.trainers.length}>
            {results.trainers.map((p) => (
              <ListRow key={p.id} icon="user" title={p.name ?? 'Trainer'} subtitle="Trainer at your gym" />
            ))}
          </Group>
        </>
      ) : null}
    </Screen>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <Card style={{ gap: 2 }}>
      <Txt variant="caption" color="textMuted">
        {title}
      </Txt>
      {children}
    </Card>
  );
}
