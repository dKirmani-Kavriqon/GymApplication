import { screen, waitFor, within } from '@testing-library/react';
import { Community } from './Community';
import { installFakeApi } from '../test/fakeApi';
import { makeGym } from '../test/fixtures';
import { COMMENTS, LEADERBOARD, makeChallenge, makePost } from '../test/fixtures2';
import { renderUi } from '../test/render';

function setup() {
  const fake = installFakeApi({
    'GET /gyms/:gymId/posts': {
      posts: [makePost(), makePost({ id: 'p-2', body: 'Spam link', hidden: true, author: { id: 'u-x', name: 'Spammer', role: 'member' } })],
    },
    'PATCH /gyms/:gymId/posts/:id': (req) => makePost({ id: req.params.id, ...(req.body as object) }),
    'DELETE /gyms/:gymId/posts/:id': { status: 204 },
    'GET /gyms/:gymId/posts/:id/comments': { comments: COMMENTS },
    'DELETE /gyms/:gymId/comments/:id': { status: 204 },
    'GET /gyms/:gymId/challenges': { challenges: [makeChallenge()] },
    'POST /gyms/:gymId/challenges': (req) => ({
      status: 201,
      body: makeChallenge({ id: 'ch-new', status: 'upcoming', participantCount: 0, ...(req.body as object) }),
    }),
    'DELETE /gyms/:gymId/challenges/:id': { status: 204 },
    'GET /gyms/:gymId/challenges/:id/leaderboard': { entries: LEADERBOARD },
  });
  return { ...renderUi(<Community gym={makeGym()} />), fake };
}

const postBy = (text: string) => screen.getByText(text).closest('[data-testid="post"]') as HTMLElement;

describe('Community: feed moderation', () => {
  it('hides and unhides posts', async () => {
    const { user, fake } = setup();
    await screen.findByText('New PR on squats today!');
    expect(within(postBy('Spam link')).getByText('Hidden')).toBeInTheDocument();

    await user.click(within(postBy('New PR on squats today!')).getByRole('button', { name: 'Hide' }));
    expect(await screen.findByText('Post hidden from members')).toBeInTheDocument();
    expect(fake.callsTo('PATCH /gyms/:gymId/posts/:id')[0]).toMatchObject({ params: { id: 'p-1' }, body: { hidden: true } });
    expect(within(postBy('New PR on squats today!')).getByRole('button', { name: 'Unhide' })).toBeInTheDocument();

    await user.click(within(postBy('Spam link')).getByRole('button', { name: 'Unhide' }));
    await screen.findByText('Post visible again');
    expect(fake.callsTo('PATCH /gyms/:gymId/posts/:id')[1]).toMatchObject({ params: { id: 'p-2' }, body: { hidden: false } });
  });

  it('can filter out hidden posts', async () => {
    const { user } = setup();
    await screen.findByText('Spam link');
    await user.click(screen.getByLabelText(/Show hidden posts \(1\)/));
    expect(screen.queryByText('Spam link')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('post')).toHaveLength(1);
  });

  it('deletes a post after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await screen.findByText('Spam link');
    await user.click(within(postBy('Spam link')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Spam link')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/posts/:id')[0].params.id).toBe('p-2');
  });

  it('shows comments and deletes one', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await screen.findByText('New PR on squats today!');
    const post = postBy('New PR on squats today!');
    expect(within(post).getByText(/4 · 1 comment/)).toBeInTheDocument();
    await user.click(within(post).getByRole('button', { name: 'Comments' }));
    expect(await within(post).findByText('Nice one!')).toBeInTheDocument();
    await user.click(within(post).getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(within(post).queryByText('Nice one!')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/comments/:id')[0].params.id).toBe('c-1');
    expect(within(post).getByText(/4 · 0 comments/)).toBeInTheDocument();
  });
});

describe('Community: challenges', () => {
  it('creates a challenge, validating that it ends after it starts', async () => {
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: 'Challenges' }));
    await screen.findByTestId('challenge');
    await user.click(screen.getByRole('button', { name: 'New challenge' }));
    const form = screen.getByRole('form', { name: 'New challenge' });
    await user.type(within(form).getByLabelText('Challenge title'), 'December workouts');
    await user.selectOptions(within(form).getByLabelText('Metric'), 'workouts');
    await user.clear(within(form).getByLabelText('Target'));
    await user.type(within(form).getByLabelText('Target'), '10');
    await user.clear(within(form).getByLabelText('Starts on'));
    await user.type(within(form).getByLabelText('Starts on'), '2026-12-10');
    await user.clear(within(form).getByLabelText('Ends on'));
    await user.type(within(form).getByLabelText('Ends on'), '2026-12-01');
    await user.click(within(form).getByRole('button', { name: 'Create challenge' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('The end date must be on or after the start date');
    expect(fake.callsTo('POST /gyms/:gymId/challenges')).toHaveLength(0);

    await user.clear(within(form).getByLabelText('Ends on'));
    await user.type(within(form).getByLabelText('Ends on'), '2026-12-31');
    await user.click(within(form).getByRole('button', { name: 'Create challenge' }));
    expect(await screen.findByText('Challenge created')).toBeInTheDocument();
    expect(fake.callsTo('POST /gyms/:gymId/challenges')[0].body).toEqual({
      title: 'December workouts',
      description: '',
      metric: 'workouts',
      target: 10,
      startsOn: '2026-12-10',
      endsOn: '2026-12-31',
    });
    expect(screen.getAllByTestId('challenge')).toHaveLength(2);
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('shows the leaderboard and deletes a challenge', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, fake } = setup();
    await user.click(screen.getByRole('tab', { name: 'Challenges' }));
    const ch = await screen.findByTestId('challenge');
    expect(within(ch).getByText(/Check-ins · target 12/)).toBeInTheDocument();
    await user.click(within(ch).getByRole('button', { name: 'Leaderboard' }));
    const board = await screen.findByRole('list', { name: 'Leaderboard for November 12 visits' });
    const rows = within(board).getAllByTestId('leader');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ravi Kumar');
    expect(rows[0]).toHaveTextContent('12/12');
    expect(within(rows[0]).getByText('Done')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('5/12');
    expect(fake.callsTo('GET /gyms/:gymId/challenges/:id/leaderboard')[0].params.id).toBe('ch-1');

    await user.click(within(ch).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByTestId('challenge')).not.toBeInTheDocument());
    expect(fake.callsTo('DELETE /gyms/:gymId/challenges/:id')[0].params.id).toBe('ch-1');
  });
});
