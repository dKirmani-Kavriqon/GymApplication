import { useCallback } from 'react';
import type { FeatureKey, Gym, ProfileInput } from '@gymverse/shared';
import { useSession } from './session';

/** The gym the member is currently using. Only call below MainShell (a gym is guaranteed there). */
export function useGym(): Gym {
  const { activeGym } = useSession();
  if (!activeGym) throw new Error('useGym needs an active gym');
  return activeGym.gym;
}

export function useFeature(key: FeatureKey): boolean {
  const { activeGym } = useSession();
  return !!activeGym?.gym.enabledFeatures.includes(key);
}

export function useIsStaff(): boolean {
  const { activeGym } = useSession();
  return !!activeGym && activeGym.role !== 'member';
}

/** Saves profile fields and updates the session (theme changes apply instantly). */
export function useSaveProfile() {
  const { api, setMe } = useSession();
  return useCallback(
    async (patch: ProfileInput) => {
      const next = await api.updateProfile(patch);
      setMe(next);
      return next;
    },
    [api, setMe],
  );
}
