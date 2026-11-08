import React from 'react';
import { ProgressScreen } from '../screens/ProgressScreen';
import { SettingsScreen } from '../screens/me/SettingsScreen';
import { NotificationsScreen } from '../screens/me/NotificationsScreen';
import { SearchScreen } from '../screens/me/SearchScreen';
import { AnnouncementsScreen } from '../screens/me/AnnouncementsScreen';
import { CoachScreen } from '../screens/me/CoachScreen';
import { SetupWizard } from '../screens/onboarding/SetupWizard';
import { useToast } from '../components/Toast';
import { featureRoutes, type ScreenComponent } from './featureRoutes';
import { useNav } from './Nav';

function EditProfileRoute() {
  const nav = useNav();
  const toast = useToast();
  return (
    <SetupWizard
      mode="edit"
      onDone={() => {
        nav.pop();
        toast.show({ title: 'Profile saved' });
      }}
    />
  );
}

/** Core full-screen routes (mine) + feature routes (featureRoutes.tsx). */
export const routes: Record<string, ScreenComponent> = {
  Search: () => <SearchScreen />,
  Notifications: () => <NotificationsScreen />,
  Settings: () => <SettingsScreen />,
  Progress: () => <ProgressScreen />,
  Announcements: () => <AnnouncementsScreen />,
  EditProfile: () => <EditProfileRoute />,
  Coach: () => <CoachScreen />,
  ...featureRoutes,
};
