import React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ErrorText, Skeleton, Pill, Screen, Txt } from '../../components/ui';
import { useSession } from '../../state/session';
import { useGym } from '../../state/hooks';
import { useNav } from '../../navigation/Nav';
import { formatDate } from '../../utils/format';
import { useLoad } from '../../utils/useLoad';

/** All gym news, pinned first. */
export function AnnouncementsScreen() {
  const { api } = useSession();
  const gym = useGym();
  const nav = useNav();
  const { data, error, loading, reload } = useLoad(() => api.announcements(gym.id), gym.id);
  return (
    <Screen title="From your gym" onBack={nav.pop} refreshing={loading} onRefresh={reload} testID="announcements">
      {!data ? (
        error ? <ErrorText message={error} /> : <Skeleton />
      ) : data.announcements.length === 0 ? (
        <EmptyState icon="volume-2" title="No news yet" body={`${gym.name} hasn't posted anything yet.`} />
      ) : (
        data.announcements.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt variant="small" color="textMuted">
                {formatDate(a.createdAt)}
              </Txt>
              {a.pinned ? <Pill label="Pinned" /> : null}
            </View>
            <Txt variant="h3" color="heading">
              {a.title}
            </Txt>
            <Txt variant="body">{a.body}</Txt>
          </Card>
        ))
      )}
    </Screen>
  );
}
