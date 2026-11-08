import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ApiError } from '../../api/client';
import { makeFakeApi, mealIdeaFixture, mealPlanFixture, renderApp } from '../../test/fakeApi';
import { MealIdeaScreen, MealPlanScreen, NutritionScreen } from './NutritionScreens';

describe('Nutrition', () => {
  it('lists meal plans and opens one', async () => {
    const { nav } = renderApp(<NutritionScreen params={{}} />);
    expect(await screen.findByText('Lean & strong (veg)')).toBeTruthy();
    expect(screen.getByText('2,200 kcal a day')).toBeTruthy();
    expect(screen.getByText('Build muscle')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Lean & strong (veg), 2200 kcal a day'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'MealPlan', params: { id: 'mp1' } });
  });

  it('shows meal ideas with kcal and protein, filtered by meal type', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<NutritionScreen params={{ tab: 'ideas' }} />, { api });
    expect(await screen.findByText('Paneer bhurji wrap')).toBeTruthy();
    expect(within(screen.getByTestId('idea-m1')).getByText('480 kcal · 32 g protein')).toBeTruthy();
    expect(api.mealIdeas).toHaveBeenLastCalledWith('gym-1', undefined);

    fireEvent.press(screen.getByLabelText('Breakfast'));
    await waitFor(() => expect(api.mealIdeas).toHaveBeenLastCalledWith('gym-1', 'breakfast'));
    await screen.findByText('Moong dal chilla');
    fireEvent.press(screen.getByLabelText('Moong dal chilla, 480 kcal · 32 g protein'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'MealIdea', params: { id: 'm2' } });
  });

  it('switches between plans and ideas', async () => {
    renderApp(<NutritionScreen params={{}} />);
    await screen.findByText('Lean & strong (veg)');
    fireEvent.press(screen.getByRole('tab', { name: 'Meal ideas' }));
    expect(await screen.findByText('Paneer bhurji wrap')).toBeTruthy();
  });

  it('shows an empty state for a meal type with no ideas', async () => {
    const api = makeFakeApi({ mealIdeas: async (_g: string, type?: string) => ({ mealIdeas: type ? [] : [mealIdeaFixture()] }) });
    renderApp(<NutritionScreen params={{ tab: 'ideas' }} />, { api });
    await screen.findByText('Paneer bhurji wrap');
    fireEvent.press(screen.getByLabelText('Dinner'));
    expect(await screen.findByText('No meal ideas here')).toBeTruthy();
  });

  it('shows the API error', async () => {
    const api = makeFakeApi({
      mealPlans: async () => {
        throw new ApiError(403, 'feature_disabled', 'Nutrition is switched off at this gym.');
      },
    });
    renderApp(<NutritionScreen params={{}} />, { api });
    expect(await screen.findByText('Nutrition is switched off at this gym.')).toBeTruthy();
  });
});

describe('Meal plan', () => {
  it('shows the daily kcal hero and meals by slot, and favourites it', async () => {
    const api = makeFakeApi({ mealPlan: async (_g: string, id: string) => mealPlanFixture({ id }) });
    renderApp(<MealPlanScreen params={{ id: 'mp1' }} />, { api });
    expect(await screen.findByText('Oats with whey')).toBeTruthy();
    expect(within(screen.getByTestId('plan-hero')).getByText(/2,200/)).toBeTruthy();
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Lunch')).toBeTruthy();
    expect(screen.getByText('520 kcal')).toBeTruthy();
    expect(screen.getByText('38 g protein')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Save Lean & strong (veg) to favourites'));
    expect(api.setFavourite).toHaveBeenCalledWith('gym-1', 'meal_plan', 'mp1', true);
    expect(screen.getByLabelText('Remove Lean & strong (veg) from favourites')).toBeTruthy();
  });
});

describe('Meal idea', () => {
  it('shows macros, ticks ingredients and lists numbered steps', async () => {
    const api = makeFakeApi();
    renderApp(<MealIdeaScreen params={{ id: 'm1' }} />, { api });
    expect(await screen.findByText('Ingredients')).toBeTruthy();
    expect(screen.getByLabelText('480 kcal')).toBeTruthy();
    expect(screen.getByLabelText('32g protein')).toBeTruthy();
    expect(screen.getByLabelText('40g carbs')).toBeTruthy();
    expect(screen.getByLabelText('20g fat')).toBeTruthy();

    const paneer = screen.getByRole('checkbox', { name: '100 g paneer' });
    expect(paneer.props.accessibilityState.checked).toBe(false);
    fireEvent.press(paneer);
    expect(screen.getByRole('checkbox', { name: '100 g paneer' }).props.accessibilityState.checked).toBe(true);

    expect(screen.getByText('Crumble the paneer')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Save Paneer bhurji wrap to favourites'));
    expect(api.setFavourite).toHaveBeenCalledWith('gym-1', 'meal_idea', 'm1', true);
  });
});
