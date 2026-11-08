export interface PlanDraft {
  include: boolean;
  name: string;
  durationDays: number;
  /** Rupees, as typed by the owner (the API wants paise). */
  priceRupees: string;
  benefits: string;
}

/** PRD §7 onboarding templates. */
export const PLAN_TEMPLATES: ReadonlyArray<Omit<PlanDraft, 'include'>> = [
  { name: 'Monthly', durationDays: 30, priceRupees: '1499', benefits: 'Full gym access' },
  { name: 'Quarterly', durationDays: 90, priceRupees: '3999', benefits: 'Full gym access\n1 PT session' },
  { name: 'Yearly', durationDays: 365, priceRupees: '12999', benefits: 'Full gym access\n4 PT sessions' },
];
