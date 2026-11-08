/**
 * Feature screens: Train (workouts), Nutrition, Resources, Community, Support, Favourites.
 * Route names here are referenced from core screens (Home quick actions, notifications,
 * search, Me) and from openLink() in Nav.tsx — keep them stable.
 */
import React from 'react';
import { TrainTab as TrainTabScreen } from '../screens/train/TrainTab';
import { RoutineDetailScreen } from '../screens/train/RoutineDetailScreen';
import { RoutineEditorScreen } from '../screens/train/RoutineEditorScreen';
import { WorkoutSessionScreen } from '../screens/train/WorkoutSessionScreen';
import { WorkoutHistoryScreen } from '../screens/train/WorkoutHistoryScreen';
import { MealIdeaScreen, MealPlanScreen, NutritionScreen } from '../screens/nutrition/NutritionScreens';
import { ArticleScreen, FavouritesScreen, ResourcesScreen } from '../screens/resources/ResourceScreens';
import { ChallengeDetailScreen, CommunityTab as CommunityTabScreen, NewPostScreen, PostScreen } from '../screens/community/CommunityScreens';
import { NewTicketScreen, SupportScreen, TicketScreen } from '../screens/support/SupportScreens';

export type ScreenProps = { params: Record<string, any> };
export type ScreenComponent = React.ComponentType<ScreenProps>;

/** Root of the Train tab. */
export const TrainTab: React.ComponentType = TrainTabScreen;

/** Root of the Community tab. */
export const CommunityTab: React.ComponentType = CommunityTabScreen;

export const featureRoutes: Record<string, ScreenComponent> = {
  RoutineDetail: RoutineDetailScreen, // params: { id }
  RoutineEditor: RoutineEditorScreen, // params: { id? } (edit when id given)
  WorkoutSession: WorkoutSessionScreen, // params: { routineId? }
  WorkoutHistory: WorkoutHistoryScreen,
  Nutrition: NutritionScreen, // params: { tab?: 'plans' | 'ideas' }
  MealPlan: MealPlanScreen, // params: { id }
  MealIdea: MealIdeaScreen, // params: { id }
  Resources: ResourcesScreen, // params: { kind?: ArticleKind }
  Article: ArticleScreen, // params: { id }
  Post: PostScreen, // params: { id, post? } (the feed passes the Post; links pass only id)
  NewPost: NewPostScreen,
  ChallengeDetail: ChallengeDetailScreen, // params: { id }
  Support: SupportScreen,
  Ticket: TicketScreen, // params: { id }
  NewTicket: NewTicketScreen,
  Favourites: FavouritesScreen,
};
