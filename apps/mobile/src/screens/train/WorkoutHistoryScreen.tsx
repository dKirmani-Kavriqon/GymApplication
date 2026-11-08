import React from 'react';
import { Screen } from '../../components/ui';
import { useNav } from '../../navigation/Nav';
import { WorkoutHistoryList } from './parts';

/** Workout history as its own screen (same list as Train → History). */
export function WorkoutHistoryScreen() {
  const nav = useNav();
  return (
    <Screen title="Workout history" onBack={nav.pop}>
      <WorkoutHistoryList onStart={() => nav.push('WorkoutSession', {})} />
    </Screen>
  );
}
