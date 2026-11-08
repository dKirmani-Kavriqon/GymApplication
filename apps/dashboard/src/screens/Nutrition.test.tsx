import { screen, waitFor, within } from '@testing-library/react';
import { Nutrition } from './Nutrition';
import { installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { makeMealIdea, makeMealPlan } from '../test/fixtures2';
import { renderUi } from '../test/render';

function setup() {
  const fake = installFakeApi({
    'GET /gyms/:gymId/meal-plans': { mealPlans: [makeMealPlan()] },
    'GET /gyms/:gymId/meal-ideas': { mealIdeas: [makeMealIdea()] },
    'POST /gyms/:gymId/meal-plans': (req) => ({ status: 201, body: makeMealPlan({ id: 'mp-new', ...(req.body as object) }) }),
    'POST /gyms/:gymId/meal-ideas': (req) => ({ status: 201, body: makeMealIdea({ id: 'mi-new', ...(req.body as object) }) }),
    'DELETE /gyms/:gymId/meal-plans/:id': { status: 204 },
    'DELETE /gyms/:gymId/meal-ideas/:id': { status: 204 },
  });
  return { ...renderUi(<Nutrition gym={makeGym()} />), fake };
}

describe('Nutrition', () => {
  it('lists meal plans with their meals', async () => {
    setup();
    const plan = await screen.findByTestId('meal-plan');
    expect(within(plan).getByRole('heading', { name: 'Lean bulk' })).toBeInTheDocument();
    expect(within(plan).getByText('2600 kcal/day')).toBeInTheDocument();
    expect(within(plan).getByText(/Build muscle · 1 meal/)).toBeInTheDocument();
    expect(within(plan).getByText('550 kcal · 40 g protein')).toBeInTheDocument();
  });

  it('creates a meal plan with two meals', async () => {
    const { user, fake } = setup();
    await screen.findByTestId('meal-plan');
    await user.click(screen.getByRole('button', { name: 'New meal plan' }));
    const form = screen.getByRole('form', { name: 'New meal plan' });
    await user.type(within(form).getByLabelText('Plan title'), 'Veg fat loss');
    await user.selectOptions(within(form).getByLabelText('Goal'), 'lose_weight');
    await user.clear(within(form).getByLabelText('Calories per day'));
    await user.type(within(form).getByLabelText('Calories per day'), '1800');
    await user.type(within(form).getByLabelText('Meal 1 title'), 'Poha with sprouts');
    await user.type(within(form).getByLabelText('Meal 1 calories'), '400');
    await user.type(within(form).getByLabelText('Meal 1 protein'), '18');
    await user.click(within(form).getByRole('button', { name: 'Add meal' }));
    expect(within(form).getByLabelText('Meal 2 slot')).toHaveValue('lunch');
    await user.type(within(form).getByLabelText('Meal 2 title'), 'Dal, rice, salad');
    await user.type(within(form).getByLabelText('Meal 2 calories'), '650');
    await user.type(within(form).getByLabelText('Meal 2 protein'), '24.5');
    await user.type(within(form).getByLabelText('Meal 2 notes'), 'Half plate salad');
    expect(within(form).getByText('1050 kcal of 1800 planned')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Create meal plan' }));

    expect(await screen.findByText('Meal plan created')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/meal-plans')[0].body).toEqual({
      title: 'Veg fat loss',
      goal: 'lose_weight',
      description: '',
      caloriesPerDay: 1800,
      meals: [
        { slot: 'breakfast', title: 'Poha with sprouts', description: '', calories: 400, proteinG: 18 },
        { slot: 'lunch', title: 'Dal, rice, salad', description: 'Half plate salad', calories: 650, proteinG: 24.5 },
      ],
    });
    expect(screen.getAllByTestId('meal-plan')).toHaveLength(2);
  });

  it('blocks a plan with a meal missing its calories', async () => {
    const { user, fake } = setup();
    await screen.findByTestId('meal-plan');
    await user.click(screen.getByRole('button', { name: 'New meal plan' }));
    await user.type(screen.getByLabelText('Plan title'), 'Quick');
    await user.type(screen.getByLabelText('Meal 1 title'), 'Eggs');
    await user.click(screen.getByRole('button', { name: 'Create meal plan' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Calories (row 1)');
    expect(fake.callsTo('POST /gyms/:gymId/meal-plans')).toHaveLength(0);
  });

  it('creates a meal idea with macros, ingredients and steps', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: /Meal ideas/ }));
    await screen.findByTestId('meal-idea');
    await user.click(screen.getByRole('button', { name: 'New meal idea' }));
    const form = screen.getByRole('form', { name: 'New meal idea' });
    await user.type(within(form).getByLabelText('Title'), 'Overnight oats');
    await user.selectOptions(within(form).getByLabelText('Meal type'), 'breakfast');
    await user.type(within(form).getByLabelText('Calories'), '350');
    await user.type(within(form).getByLabelText('Protein (g)'), '20');
    await user.type(within(form).getByLabelText('Carbs (g)'), '45');
    await user.type(within(form).getByLabelText('Ingredients (one per line)'), 'Oats{Enter}Milk{Enter}Banana');
    await user.type(within(form).getByLabelText('Steps (one per line)'), 'Mix{Enter}Refrigerate overnight');
    await user.type(within(form).getByLabelText('Tags (comma separated)'), 'quick, vegetarian');
    await user.click(within(form).getByRole('button', { name: 'Add meal idea' }));
    expect(await screen.findByText('Meal idea added')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/meal-ideas')[0].body).toEqual({
      title: 'Overnight oats',
      mealType: 'breakfast',
      calories: 350,
      proteinG: 20,
      carbsG: 45,
      fatG: 0,
      ingredients: ['Oats', 'Milk', 'Banana'],
      steps: ['Mix', 'Refrigerate overnight'],
      imageUrl: null,
      tags: ['quick', 'vegetarian'],
    });
  });

  it('deletes plans and ideas', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await screen.findByTestId('meal-plan');
    await user.click(screen.getByRole('button', { name: 'Delete Lean bulk' }));
    await waitFor(() => expect(screen.queryByTestId('meal-plan')).not.toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Meal ideas/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete Paneer wrap' }));
    await waitFor(() => expect(screen.queryByTestId('meal-idea')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/meal-plans/:id')[0].params.id).toBe('mp-1');
    expect(fake.callsTo('DELETE /gyms/:gymId/meal-ideas/:id')[0].params.id).toBe('mi-1');
  });
});
