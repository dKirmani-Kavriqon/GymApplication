import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { articleFixture, makeFakeApi, mealIdeaFixture, mealPlanFixture, renderApp, routineFixture } from '../../test/fakeApi';
import { ArticleScreen, FavouritesScreen, ResourcesScreen } from './ResourceScreens';

describe('Resources', () => {
  it('lists everything, then filters by kind', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<ResourcesScreen params={{}} />, { api });
    expect(await screen.findByText('How to warm up properly')).toBeTruthy();
    expect(screen.getByText('Perfect push-up form')).toBeTruthy();
    expect(screen.getByText('Article · 3 min read')).toBeTruthy();
    expect(screen.getAllByText('Five minutes that prevent most gym injuries.')).toHaveLength(3);
    expect(api.articles).toHaveBeenLastCalledWith('gym-1', undefined);

    fireEvent.press(screen.getByLabelText('Videos'));
    await waitFor(() => expect(api.articles).toHaveBeenLastCalledWith('gym-1', 'video'));
    fireEvent.press(screen.getByLabelText('Tips'));
    await waitFor(() => expect(api.articles).toHaveBeenLastCalledWith('gym-1', 'tip'));
    await screen.findByText('Drink water before you feel thirsty');

    fireEvent.press(screen.getByLabelText('Tip: Drink water before you feel thirsty. 3 min read'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'Article', params: { id: 'a3' } });
  });

  it('starts on the kind passed in params', async () => {
    const api = makeFakeApi();
    renderApp(<ResourcesScreen params={{ kind: 'video' }} />, { api });
    await waitFor(() => expect(api.articles).toHaveBeenCalledWith('gym-1', 'video'));
  });

  it('shows an empty state', async () => {
    const api = makeFakeApi({ articles: async () => ({ articles: [] }) });
    renderApp(<ResourcesScreen params={{}} />, { api });
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
  });
});

describe('Article', () => {
  it('shows title, author, tags and body paragraphs, and favourites it', async () => {
    const api = makeFakeApi();
    renderApp(<ArticleScreen params={{ id: 'a1' }} />, { api });
    expect(await screen.findByText('How to warm up properly')).toBeTruthy();
    expect(screen.getByText(/By Coach Vikram · 3 min read/)).toBeTruthy();
    expect(screen.getByText('beginner')).toBeTruthy();
    expect(screen.getByText('Start with light cardio.')).toBeTruthy();
    expect(screen.getByText('Then move through each joint.')).toBeTruthy();
    expect(screen.queryByLabelText('Watch video')).toBeNull();

    fireEvent.press(screen.getByLabelText('Save How to warm up properly to favourites'));
    expect(api.setFavourite).toHaveBeenCalledWith('gym-1', 'article', 'a1', true);
  });

  it('opens the video for video resources', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const api = makeFakeApi({ article: async (_g: string, id: string) => articleFixture({ id, kind: 'video', title: 'Perfect push-up form', videoUrl: 'https://example.com/v.mp4' }) });
    renderApp(<ArticleScreen params={{ id: 'a2' }} />, { api });
    fireEvent.press(await screen.findByLabelText('Watch video'));
    expect(open).toHaveBeenCalledWith('https://example.com/v.mp4');
    open.mockRestore();
  });
});

describe('Favourites', () => {
  it('groups saved items into sections that navigate', async () => {
    const api = makeFakeApi({
      favourites: async () => ({
        routines: [routineFixture({ favourite: true })],
        articles: [articleFixture({ favourite: true })],
        mealIdeas: [mealIdeaFixture({ favourite: true })],
        mealPlans: [mealPlanFixture({ favourite: true })],
      }),
    });
    const { nav } = renderApp(<FavouritesScreen />, { api });
    expect(await screen.findByText('Routines')).toBeTruthy();
    expect(screen.getByText('Articles')).toBeTruthy();
    expect(screen.getByText('Recipes')).toBeTruthy();
    expect(screen.getByText('Meal plans')).toBeTruthy();

    fireEvent.press(screen.getByText('Push day'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'RoutineDetail', params: { id: 'r1' } });
    fireEvent.press(screen.getByText('How to warm up properly'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'Article', params: { id: 'a1' } });
    fireEvent.press(screen.getByText('Paneer bhurji wrap'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'MealIdea', params: { id: 'm1' } });
    fireEvent.press(screen.getByText('Lean & strong (veg)'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'MealPlan', params: { id: 'mp1' } });
  });

  it('shows an empty state with nothing saved', async () => {
    renderApp(<FavouritesScreen />);
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
  });
});
