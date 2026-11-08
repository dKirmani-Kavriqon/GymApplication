import React, { useState } from 'react';
import { View } from 'react-native';
import type { Routine } from '@gymverse/shared';
import { Card, EmptyState, IconTile, Screen, SectionHeader, Segmented, Txt, Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useNav } from '../../navigation/Nav';
import { useFeature } from '../../state/hooks';
import { useTheme } from '../../theme/ThemeContext';
import { useLoad } from '../../utils/useLoad';
import { Gate, useBus, useGymApi } from './common';
import { RoutineCard, WorkoutHistoryList } from './parts';

type Seg = 'routines' | 'history';

/** Root of the Train tab: routines (coach / gym / mine) and workout history. */
export function TrainTab() {
  const [seg, setSeg] = useState<Seg>('routines');
  const { api, gymId } = useGymApi();
  const nav = useNav();
  const t = useTheme();
  const showProgress = useFeature('progress');
  const { data, error, loading, reload } = useLoad(() => api.routines(gymId), gymId);
  useBus('routines:changed', () => void reload());
  useBus('favourites:changed', () => void reload());

  const open = (r: Routine) => nav.push('RoutineDetail', { id: r.id });

  return (
    <Screen title="Train" testID="train-tab" refreshing={seg === 'routines' && loading && !!data} onRefresh={seg === 'routines' ? reload : undefined}>
      <Segmented<Seg>
        options={[
          { id: 'routines', label: 'Routines' },
          { id: 'history', label: 'History' },
        ]}
        value={seg}
        onChange={setSeg}
      />

      {seg === 'history' ? (
        <WorkoutHistoryList onStart={() => setSeg('routines')} />
      ) : (
        <>
          {showProgress ? (
            <Card variant="tint" onPress={() => nav.push('Progress')} accessibilityLabel="Your progress. See charts of your workouts and weight" testID="progress-card">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile icon="bar-chart-2" tone="primary" />
                <View style={{ flex: 1 }}>
                  <Txt variant="h3" color="heading">
                    Your progress
                  </Txt>
                  <Txt variant="small" color="textMuted">
                    Charts of your workouts and weight
                  </Txt>
                </View>
                <Icon name="arrow-right" size={20} color={t.primaryText} />
              </View>
            </Card>
          ) : null}

          <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
            {() => (
              <>
                {data!.assigned.length ? (
                  <View style={{ gap: 12 }}>
                    <SectionHeader title="From your coach" />
                    {data!.assigned.map((r, i) => (
                      <RoutineCard key={r.id} index={i} routine={r} showCoach onPress={() => open(r)} />
                    ))}
                  </View>
                ) : null}

                <View style={{ gap: 12 }}>
                  <SectionHeader title="Gym programmes" />
                  {data!.presets.length ? (
                    data!.presets.map((r, i) => <RoutineCard key={r.id} index={i} routine={r} onPress={() => open(r)} />)
                  ) : (
                    <Txt color="textMuted">Your gym has not published any programmes yet.</Txt>
                  )}
                </View>

                <View style={{ gap: 12 }}>
                  <SectionHeader title="My routines" />
                  {data!.mine.length ? (
                    data!.mine.map((r, i) => <RoutineCard key={r.id} index={i} routine={r} onPress={() => open(r)} />)
                  ) : (
                    <EmptyState icon="edit-3" title="Make it your own" body="Build a routine with the exercises you like." />
                  )}
                  <Button label="Build your own" icon="plus" variant="outline" onPress={() => nav.push('RoutineEditor')} />
                  <Button label="Quick workout" icon="zap" variant="ghost" onPress={() => nav.push('WorkoutSession', {})} />
                </View>
              </>
            )}
          </Gate>
        </>
      )}
    </Screen>
  );
}
