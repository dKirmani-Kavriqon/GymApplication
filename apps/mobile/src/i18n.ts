import { useSession } from './state/session';

/**
 * Minimal translations for the core navigation and home strings (PRD: English + Hindi).
 * Untranslated keys fall back to English. Content written by gyms is shown as written.
 */
const STRINGS = {
  en: {
    'tab.home': 'Home',
    'tab.classes': 'Classes',
    'tab.train': 'Train',
    'tab.community': 'Community',
    'tab.me': 'Me',
    'home.morning': 'Good morning,',
    'home.afternoon': 'Good afternoon,',
    'home.evening': 'Good evening,',
    'home.search': 'Search classes, workouts, recipes…',
    'home.checkin': 'Check in now',
    'home.checkedIn': 'Checked in today',
    'home.weeklyGoal': 'Weekly goal',
    'home.quick': 'Quick actions',
    'home.upcoming': 'Upcoming',
    'common.seeAll': 'See all',
    'common.back': 'Back',
    'common.save': 'Save',
    'common.skip': 'Skip',
    'common.next': 'Next',
  },
  hi: {
    'tab.home': 'होम',
    'tab.classes': 'क्लास',
    'tab.train': 'ट्रेनिंग',
    'tab.community': 'कम्युनिटी',
    'tab.me': 'मैं',
    'home.morning': 'सुप्रभात,',
    'home.afternoon': 'नमस्ते,',
    'home.evening': 'शुभ संध्या,',
    'home.search': 'क्लास, वर्कआउट, रेसिपी खोजें…',
    'home.checkin': 'अभी चेक-इन करें',
    'home.checkedIn': 'आज चेक-इन हो गया',
    'home.weeklyGoal': 'साप्ताहिक लक्ष्य',
    'home.quick': 'त्वरित विकल्प',
    'home.upcoming': 'आने वाले',
    'common.seeAll': 'सभी देखें',
    'common.back': 'वापस',
    'common.save': 'सेव करें',
    'common.skip': 'छोड़ें',
    'common.next': 'आगे',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['en'];

export function translate(lang: string | undefined, key: StringKey): string {
  const table = (STRINGS as Record<string, Partial<Record<StringKey, string>>>)[lang ?? 'en'] ?? STRINGS.en;
  return table[key] ?? STRINGS.en[key];
}

export function useT(): (key: StringKey) => string {
  const { me } = useSession();
  const lang = me?.profile.language;
  return (key) => translate(lang, key);
}
