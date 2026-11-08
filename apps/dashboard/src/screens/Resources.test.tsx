import { screen, waitFor, within } from '@testing-library/react';
import type { Article } from '@gymverse/shared';
import { Resources } from './Resources';
import { apiError, installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { makeArticle } from '../test/fixtures2';
import { renderUi } from '../test/render';

const LIST: Article[] = [
  makeArticle(),
  makeArticle({ id: 'a-2', kind: 'video', title: 'Deadlift form', videoUrl: 'https://youtu.be/x', tags: [] }),
  makeArticle({ id: 'a-3', kind: 'tip', title: 'Drink water', tags: ['hydration'] }),
];

function setup(list: Article[] = LIST) {
  const fake = installFakeApi({
    'GET /gyms/:gymId/articles': { articles: list },
    'POST /gyms/:gymId/articles': (req) => ({ status: 201, body: makeArticle({ id: 'a-new', ...(req.body as object), readMinutes: 2 }) }),
    'PATCH /gyms/:gymId/articles/:id': (req) => makeArticle({ id: req.params.id, ...(req.body as object) }),
    'DELETE /gyms/:gymId/articles/:id': { status: 204 },
  });
  return { ...renderUi(<Resources gym={makeGym()} />), fake };
}

describe('Resources', () => {
  it('lists resources and filters by type', async () => {
    const { user } = setup();
    expect(await screen.findAllByTestId('resource')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Videos/ }));
    const items = screen.getAllByTestId('resource');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByRole('heading', { name: 'Deadlift form' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Tips/ }));
    expect(within(screen.getByTestId('resource')).getByText('#hydration')).toBeInTheDocument();
  });

  it('creates an article with tags and URLs', async () => {
    const { user, fake } = setup([]);
    await screen.findByText(/Nothing published yet/);
    await user.click(screen.getByRole('button', { name: 'New resource' }));
    const form = screen.getByRole('form', { name: 'New resource' });
    await user.click(within(form).getByLabelText('Tip'));
    await user.type(within(form).getByLabelText('Title'), 'Sleep 8 hours');
    await user.type(within(form).getByLabelText('Summary'), 'Recovery happens at night');
    await user.type(within(form).getByLabelText('Body'), 'Muscles grow when you rest.');
    await user.type(within(form).getByLabelText('Tags (comma separated)'), 'recovery, sleep,');
    await user.type(within(form).getByLabelText('Image URL'), 'https://cdn.example.com/sleep.jpg');
    await user.click(within(form).getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('Resource published')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/articles')[0].body).toEqual({
      kind: 'tip',
      title: 'Sleep 8 hours',
      summary: 'Recovery happens at night',
      body: 'Muscles grow when you rest.',
      tags: ['recovery', 'sleep'],
      imageUrl: 'https://cdn.example.com/sleep.jpg',
      videoUrl: null,
    });
    expect(screen.getByRole('heading', { name: 'Sleep 8 hours' })).toBeInTheDocument();
  });

  it('validates with the shared schema (title, video URL) before calling the API', async () => {
    const { user, fake } = setup([]);
    await screen.findByText(/Nothing published yet/);
    await user.click(screen.getByRole('button', { name: 'New resource' }));
    await user.type(screen.getByLabelText('Title'), 'X');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Title: Enter at least 2 characters');
    await user.type(screen.getByLabelText('Title'), 'Y video');
    await user.click(screen.getByLabelText('Video'));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add the video URL for a video.');
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('edits an article with a PATCH of the full body', async () => {
    const { user, fake } = setup();
    await screen.findAllByTestId('resource');
    await user.click(screen.getByRole('button', { name: 'Edit Warm up properly' }));
    const form = screen.getByRole('form', { name: 'Edit resource' });
    expect(within(form).getByLabelText('Tags (comma separated)')).toHaveValue('mobility');
    await user.clear(within(form).getByLabelText('Title'));
    await user.type(within(form).getByLabelText('Title'), 'Warm up in 5 minutes');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Resource saved');
    const call = fake.callsTo('PATCH /gyms/:gymId/articles/:id')[0];
    expect(call.params.id).toBe('a-1');
    expect(call.body).toEqual({
      kind: 'article',
      title: 'Warm up in 5 minutes',
      summary: 'Five minutes that save your knees',
      body: 'Start with light cardio.',
      tags: ['mobility'],
      imageUrl: null,
      videoUrl: null,
    });
    expect(screen.getByRole('heading', { name: 'Warm up in 5 minutes' })).toBeInTheDocument();
  });

  it('deletes after confirming and shows API errors', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await screen.findAllByTestId('resource');
    await user.click(screen.getByRole('button', { name: 'Delete Drink water' }));
    await waitFor(() => expect(screen.getAllByTestId('resource')).toHaveLength(2));
    expect(fake.callsTo('DELETE /gyms/:gymId/articles/:id')[0].params.id).toBe('a-3');
  });

  it('shows the API error when saving fails', async () => {
    installFakeApi({
      'GET /gyms/:gymId/articles': { articles: [] },
      'POST /gyms/:gymId/articles': apiError(403, 'Resources are switched off for this gym.', 'feature_disabled'),
    });
    const { user } = renderUi(<Resources gym={makeGym()} />);
    await screen.findByText(/Nothing published yet/);
    await user.click(screen.getByRole('button', { name: 'New resource' }));
    await user.type(screen.getByLabelText('Title'), 'Hello there');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resources are switched off for this gym.');
  });
});
