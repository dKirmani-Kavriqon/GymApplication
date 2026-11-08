import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { GOALS, MEAL_TYPES, humanize, labelOf, type MealIdea, type MealPlan, type MealType } from '@gymverse/shared';
import { Card, Chip, EmptyState, IconTile, Pill, Screen, Segmented, Stat, Txt } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useNav } from '../../navigation/Nav';
import { useTheme } from '../../theme/ThemeContext';
import { tapFeedback } from '../../utils/feedback';
import { useLoad } from '../../utils/useLoad';
import { FavouriteButton, Gate, bigNumber, useBus, useGymApi } from '../train/common';
import type { ScreenProps } from '../../navigation/featureRoutes';

const MEAL_ICONS: Record<MealType, IconName> = { breakfast: 'sunrise', lunch: 'sun', snack: 'coffee', dinner: 'moon' };

const macroLine = (kcal: number, protein: number) => `${bigNumber(kcal)} kcal · ${Math.round(protein)} g protein`;

// ---------- list ----------

type Tab = 'plans' | 'ideas';

export function NutritionScreen({ params }: ScreenProps) {
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const [tab, setTab] = useState<Tab>(params.tab === 'ideas' ? 'ideas' : 'plans');
  const [mealType, setMealType] = useState<MealType | null>(null);
  const plans = useLoad(() => api.mealPlans(gymId), gymId);
  const ideas = useLoad(() => (tab === 'ideas' ? api.mealIdeas(gymId, mealType ?? undefined) : Promise.resolve(null)), `${gymId}|${tab}|${mealType}`);
  useBus('favourites:changed', () => {
    void plans.reload();
    if (tab === 'ideas') void ideas.reload();
  });

  return (
    <Screen title="Nutrition" onBack={nav.pop}>
      <Segmented<Tab>
        options={[
          { id: 'plans', label: 'Meal plans' },
          { id: 'ideas', label: 'Meal ideas' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'plans' ? (
        <Gate loading={plans.loading} error={plans.error} ready={!!plans.data} onRetry={plans.reload}>
          {() =>
            plans.data!.mealPlans.length === 0 ? (
              <EmptyState icon="book-open" title="No meal plans yet" body="Your gym has not shared any meal plans. Check back soon." />
            ) : (
              <View style={{ gap: 12 }}>
                {plans.data!.mealPlans.map((p, i) => (
                  <PlanCard key={p.id} index={i} plan={p} onPress={() => nav.push('MealPlan', { id: p.id })} />
                ))}
              </View>
            )
          }
        </Gate>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="All" selected={mealType === null} onPress={() => setMealType(null)} />
            {MEAL_TYPES.map((m) => (
              <Chip key={m} label={humanize(m)} icon={MEAL_ICONS[m]} selected={mealType === m} onPress={() => setMealType(m)} />
            ))}
          </ScrollView>
          <Gate loading={ideas.loading} error={ideas.error} ready={!!ideas.data && !ideas.loading} onRetry={ideas.reload}>
            {() =>
              ideas.data!.mealIdeas.length === 0 ? (
                <EmptyState icon="coffee" title="No meal ideas here" body={mealType ? `Nothing for ${humanize(mealType).toLowerCase()} yet. Try another meal.` : 'Your gym has not shared any meal ideas yet.'} />
              ) : (
                <View style={{ gap: 12 }}>
                  {ideas.data!.mealIdeas.map((m, i) => (
                    <IdeaCard key={m.id} index={i} idea={m} onPress={() => nav.push('MealIdea', { id: m.id })} />
                  ))}
                </View>
              )
            }
          </Gate>
        </>
      )}
    </Screen>
  );
}

function PlanCard({ plan, onPress, index }: { plan: MealPlan; onPress: () => void; index?: number }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${plan.title}, ${plan.caloriesPerDay} kcal a day`} testID={`plan-${plan.id}`} index={index}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <IconTile icon="book-open" />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h3" color="heading">
            {plan.title}
          </Txt>
          <Txt variant="small" color="textMuted" numberOfLines={2}>
            {plan.description}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill label={`${bigNumber(plan.caloriesPerDay)} kcal a day`} tone="primary" />
        {plan.goal ? <Pill label={labelOf(GOALS, plan.goal)} /> : null}
        <Pill label={`${plan.meals.length} meals`} tone="muted" />
      </View>
    </Card>
  );
}

function IdeaCard({ idea, onPress, index }: { idea: MealIdea; onPress: () => void; index?: number }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${idea.title}, ${macroLine(idea.calories, idea.proteinG)}`} testID={`idea-${idea.id}`} index={index}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <IconTile icon={MEAL_ICONS[idea.mealType]} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="caption" color="textMuted">
            {humanize(idea.mealType)}
          </Txt>
          <Txt variant="bodyStrong">{idea.title}</Txt>
          <Txt variant="small" color="textMuted">
            {macroLine(idea.calories, idea.proteinG)}
          </Txt>
        </View>
      </View>
    </Card>
  );
}

// ---------- meal plan ----------

export function MealPlanScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const nav = useNav();
  const { api, gymId } = useGymApi();
  const { data, error, loading, reload } = useLoad(() => api.mealPlan(gymId, id), `${gymId}|${id}`);
  return (
    <Screen title={data?.title ?? 'Meal plan'} onBack={nav.pop} right={data ? <FavouriteButton kind="meal_plan" id={data.id} value={data.favourite} name={data.title} /> : undefined}>
      <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
        {() => {
          const p = data!;
          const protein = p.meals.reduce((s, m) => s + m.proteinG, 0);
          const slots = MEAL_TYPES.filter((s) => p.meals.some((m) => m.slot === s));
          return (
            <>
              <Card variant="tint" style={{ gap: 10 }} testID="plan-hero">
                <Txt variant="caption" color="textMuted">
                  Daily target
                </Txt>
                <Txt variant="display" color="heading">
                  {bigNumber(p.caloriesPerDay)}
                  <Txt variant="h3" color="textMuted">
                    {' '}
                    kcal
                  </Txt>
                </Txt>
                {p.goal ? <Pill label={labelOf(GOALS, p.goal)} tone="primary" /> : null}
                {p.description ? <Txt>{p.description}</Txt> : null}
                <Txt variant="small" color="textMuted">
                  {p.meals.length} meals · {Math.round(protein)} g protein in total
                </Txt>
              </Card>
              {slots.map((slot) => (
                <View key={slot} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <IconTile icon={MEAL_ICONS[slot]} size={32} />
                    <Txt variant="h3" color="heading" accessibilityRole="header">
                      {humanize(slot)}
                    </Txt>
                  </View>
                  {p.meals
                    .filter((m) => m.slot === slot)
                    .map((m, i) => (
                      <Card key={`${slot}-${i}`}>
                        <Txt variant="bodyStrong">{m.title}</Txt>
                        {m.description ? (
                          <Txt variant="small" color="textMuted">
                            {m.description}
                          </Txt>
                        ) : null}
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pill label={`${bigNumber(m.calories)} kcal`} />
                          <Pill label={`${Math.round(m.proteinG)} g protein`} tone="muted" />
                        </View>
                      </Card>
                    ))}
                </View>
              ))}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}

// ---------- meal idea ----------

export function MealIdeaScreen({ params }: ScreenProps) {
  const id = String(params.id);
  const nav = useNav();
  const t = useTheme();
  const { api, gymId } = useGymApi();
  const { data, error, loading, reload } = useLoad(() => api.mealIdea(gymId, id), `${gymId}|${id}`);
  const [ticked, setTicked] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Screen title={data?.title ?? 'Recipe'} onBack={nav.pop} right={data ? <FavouriteButton kind="meal_idea" id={data.id} value={data.favourite} name={data.title} /> : undefined}>
      <Gate loading={loading} error={error} ready={!!data} onRetry={reload}>
        {() => {
          const m = data!;
          return (
            <>
              <Card variant="tint" style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Pill label={humanize(m.mealType)} tone="primary" />
                  {m.tags.map((tag) => (
                    <Pill key={tag} label={tag} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }} testID="macros">
                  <Stat value={bigNumber(m.calories)} label="kcal" />
                  <Stat value={`${Math.round(m.proteinG)}g`} label="protein" />
                  <Stat value={`${Math.round(m.carbsG)}g`} label="carbs" />
                  <Stat value={`${Math.round(m.fatG)}g`} label="fat" />
                </View>
              </Card>

              {m.ingredients.length ? (
                <Card style={{ gap: 4 }}>
                  <Txt variant="h3" color="heading" accessibilityRole="header">
                    Ingredients
                  </Txt>
                  <Txt variant="small" color="textMuted">
                    Tap to tick off what you have.
                  </Txt>
                  {m.ingredients.map((ing, i) => {
                    const on = ticked.has(i);
                    return (
                      <Pressable
                        key={i}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={ing}
                        onPress={() => {
                          tapFeedback();
                          toggle(i);
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}
                      >
                        <Icon name={on ? 'check-square' : 'square'} size={22} color={on ? t.primaryText : t.textMuted} />
                        <Txt style={{ flex: 1, textDecorationLine: on ? 'line-through' : 'none' }} color={on ? 'textMuted' : 'text'}>
                          {ing}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </Card>
              ) : null}

              {m.steps.length ? (
                <Card style={{ gap: 12 }}>
                  <Txt variant="h3" color="heading" accessibilityRole="header">
                    Steps
                  </Txt>
                  {m.steps.map((s, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                        <Txt variant="smallStrong" color="onPrimary">
                          {i + 1}
                        </Txt>
                      </View>
                      <Txt style={{ flex: 1, paddingTop: 4 }}>{s}</Txt>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
