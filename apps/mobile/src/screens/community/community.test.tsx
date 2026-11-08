import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { ApiError } from '../../api/client';
import { challengeFixture, commentFixture, makeFakeApi, postFixture, renderApp } from '../../test/fakeApi';
import { ChallengeDetailScreen, CommunityTab, NewPostScreen, PostScreen } from './CommunityScreens';
import { challengeWhen } from './parts';

describe('Community feed', () => {
  it('shows posts with author, coach pill, likes and comments', async () => {
    const api = makeFakeApi({ posts: async () => ({ posts: [postFixture(), postFixture({ id: 'p2', author: { id: 'coach', name: 'Coach Vikram', role: 'trainer' }, body: 'Mobility class moved to 7am' })] }) });
    const { nav } = renderApp(<CommunityTab />, { api });
    expect(await screen.findByText('Hit a new deadlift PR today! 🎉')).toBeTruthy();
    expect(within(screen.getByTestId('post-p2')).getByText('Coach')).toBeTruthy();
    expect(within(screen.getByTestId('post-p1')).queryByText('Coach')).toBeNull();
    expect(within(screen.getByTestId('post-p1')).getByLabelText('Like, 4 likes')).toBeTruthy();

    fireEvent.press(within(screen.getByTestId('post-p1')).getByLabelText('1 comment, open'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'Post', params: { id: 'p1', post: expect.objectContaining({ id: 'p1' }) } });

    fireEvent.press(screen.getByLabelText('Write a post'));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'NewPost' });
  });

  it('likes optimistically and settles on the server count', async () => {
    let resolve: (v: { likeCount: number; likedByMe: boolean }) => void = () => undefined;
    const api = makeFakeApi({ setLike: () => new Promise((r) => (resolve = r)) });
    renderApp(<CommunityTab />, { api });
    fireEvent.press(await screen.findByLabelText('Like, 4 likes'));
    // optimistic, before the server answers
    expect(screen.getByLabelText('Unlike, 5 likes')).toBeTruthy();
    expect(api.setLike).toHaveBeenCalledWith('gym-1', 'p1', true);
    resolve({ likeCount: 9, likedByMe: true });
    expect(await screen.findByLabelText('Unlike, 9 likes')).toBeTruthy();
  });

  it('rolls the like back when the server fails', async () => {
    const api = makeFakeApi({
      setLike: async () => {
        throw new ApiError(0, 'network', 'No internet connection.');
      },
    });
    renderApp(<CommunityTab />, { api });
    fireEvent.press(await screen.findByLabelText('Like, 4 likes'));
    expect(await screen.findByText('No internet connection.')).toBeTruthy();
    expect(within(screen.getByTestId('post-p1')).getByLabelText('Like, 4 likes')).toBeTruthy();
  });

  it('deletes my own post after an in-page confirm', async () => {
    const api = makeFakeApi({ posts: async () => ({ posts: [postFixture({ id: 'mine', mine: true, author: { id: 'u1', name: 'Ravi Kumar', role: 'member' }, body: 'My first post' }), postFixture()] }) });
    renderApp(<CommunityTab />, { api });
    await screen.findByText('My first post');
    expect(within(screen.getByTestId('post-p1')).queryByLabelText('Delete your post')).toBeNull();
    fireEvent.press(screen.getByLabelText('Delete your post'));
    expect(screen.getByText('Delete this post?')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('confirm-delete-post')).getByLabelText('Delete'));
    await waitFor(() => expect(api.deletePost).toHaveBeenCalledWith('gym-1', 'mine'));
    await waitFor(() => expect(screen.queryByText('My first post')).not.toBeOnTheScreen());
    expect(api.deletePost).toHaveBeenCalledWith('gym-1', 'mine');
    expect(screen.getByText('Hit a new deadlift PR today! 🎉')).toBeTruthy();
  });

  it('loads older posts with "before"', async () => {
    const page = Array.from({ length: 20 }, (_, i) => postFixture({ id: `p${i}`, body: `Post ${i}`, createdAt: `2026-11-08T0${Math.floor(i / 10)}:${String(59 - i).padStart(2, '0')}:00Z` }));
    const api = makeFakeApi({
      posts: async (_g: string, before?: string) => ({ posts: before ? [postFixture({ id: 'old', body: 'An older post' })] : page }),
    });
    renderApp(<CommunityTab />, { api });
    fireEvent.press(await screen.findByLabelText('Load more'));
    expect(await screen.findByText('An older post')).toBeTruthy();
    expect(api.posts).toHaveBeenLastCalledWith('gym-1', page[19].createdAt);
    expect(screen.queryByLabelText('Load more')).toBeNull();
  });

  it('shows the API error on the feed', async () => {
    const api = makeFakeApi({
      posts: async () => {
        throw new ApiError(500, 'error', 'Something went wrong. Please try again.');
      },
    });
    renderApp(<CommunityTab />, { api });
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});

describe('New post', () => {
  it('creates a post, shows a toast and goes back', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<NewPostScreen />, { api });
    await screen.findByLabelText('Your post');
    fireEvent.press(screen.getByLabelText('Post'));
    expect(screen.getByText('Write something first.')).toBeTruthy();
    expect(api.createPost).not.toHaveBeenCalled();

    act(() => nav().push('NewPost'));
    fireEvent.changeText(screen.getByLabelText('Your post'), '  Leg day done!  ');
    fireEvent.press(screen.getByLabelText('Post'));
    await waitFor(() => expect(api.createPost).toHaveBeenCalledWith('gym-1', 'Leg day done!'));
    expect(await screen.findByText('Posted')).toBeTruthy();
    expect(nav().stack).toHaveLength(0);
  });
});

describe('Post screen', () => {
  it('shows the post from params and its comments, and adds a comment', async () => {
    const api = makeFakeApi({
      comments: async () => ({ comments: [commentFixture({ id: 'c2', body: 'Later one', createdAt: '2026-11-08T07:00:00Z' }), commentFixture()] }),
    });
    renderApp(<PostScreen params={{ id: 'p1', post: postFixture() }} />, { api });
    expect(await screen.findByText('Hit a new deadlift PR today! 🎉')).toBeTruthy();
    expect(await screen.findByText('Congrats!')).toBeTruthy();
    expect(api.posts).not.toHaveBeenCalled();
    // oldest first
    const bodies = screen.getAllByText(/Congrats!|Later one/).map((n) => n.props.children);
    expect(bodies).toEqual(['Congrats!', 'Later one']);

    fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Well done!');
    fireEvent.press(screen.getByLabelText('Send comment'));
    expect(await screen.findByText('Well done!')).toBeTruthy();
    expect(api.addComment).toHaveBeenCalledWith('gym-1', 'p1', 'Well done!');
    expect(screen.getByLabelText('2 comments')).toBeTruthy();
  });

  it('loads the post by id from a notification link', async () => {
    const api = makeFakeApi();
    renderApp(<PostScreen params={{ id: 'p1' }} />, { api });
    expect(await screen.findByText('Hit a new deadlift PR today! 🎉')).toBeTruthy();
    expect(api.posts).toHaveBeenCalledWith('gym-1');
  });

  it('says when a linked post is gone', async () => {
    renderApp(<PostScreen params={{ id: 'gone' }} />);
    expect(await screen.findByText('This post is no longer available.')).toBeTruthy();
  });

  it('deletes my own comment', async () => {
    const api = makeFakeApi({ comments: async () => ({ comments: [commentFixture({ id: 'c-mine', body: 'My comment', mine: true, author: { id: 'u1', name: 'Ravi Kumar' } })] }) });
    renderApp(<PostScreen params={{ id: 'p1', post: postFixture() }} />, { api });
    fireEvent.press(await screen.findByLabelText('Delete your comment'));
    fireEvent.press(within(screen.getByTestId('confirm-delete-comment')).getByLabelText('Delete'));
    await waitFor(() => expect(screen.queryByText('My comment')).not.toBeOnTheScreen());
    expect(api.deleteComment).toHaveBeenCalledWith('gym-1', 'c-mine');
  });
});

describe('Challenges', () => {
  it('lists challenges with progress, and joins one', async () => {
    const api = makeFakeApi();
    const { nav } = renderApp(<CommunityTab />, { api });
    await screen.findByText('Hit a new deadlift PR today! 🎉');
    fireEvent.press(screen.getByRole('tab', { name: 'Challenges' }));
    expect(await screen.findByText('30 check-ins in November')).toBeTruthy();
    expect(screen.getByText('6 / 30 check-ins')).toBeTruthy();
    expect(within(screen.getByTestId('challenge-ch1')).getByText('12 people taking part')).toBeTruthy();
    expect(within(screen.getByTestId('challenge-ch2')).getByText('Goal: 8 workouts')).toBeTruthy();

    fireEvent.press(within(screen.getByTestId('challenge-ch2')).getByLabelText('Join'));
    await waitFor(() => expect(api.setJoined).toHaveBeenCalledWith('gym-1', 'ch2', true));
    expect(await screen.findByText('You joined the challenge')).toBeTruthy();
    expect(await within(screen.getByTestId('challenge-ch2')).findByLabelText('Leave')).toBeTruthy();

    fireEvent.press(within(screen.getByTestId('challenge-ch1')).getByLabelText(/^30 check-ins in November/));
    expect(nav().stack.at(-1)).toMatchObject({ name: 'ChallengeDetail', params: { id: 'ch1' } });
  });

  it('describes when a challenge runs', () => {
    const now = new Date('2026-11-08T09:00:00');
    expect(challengeWhen(challengeFixture(), now)).toBe('22 days left');
    expect(challengeWhen(challengeFixture({ status: 'upcoming', startsOn: '2026-11-11' }), now)).toBe('Starts in 3 days');
    expect(challengeWhen(challengeFixture({ status: 'ended' }), now)).toBe('Ended');
  });

  it('shows the detail, joins, and highlights me on the leaderboard', async () => {
    const api = makeFakeApi({ challenges: async () => ({ challenges: [challengeFixture({ joined: false, myProgress: 0, myRank: null })] }) });
    renderApp(<ChallengeDetailScreen params={{ id: 'ch1' }} />, { api });
    expect(await screen.findByText('30 check-ins in November')).toBeTruthy();
    expect(screen.getByText('Show up 30 times this month.')).toBeTruthy();
    expect(await screen.findByText('Anita Desai')).toBeTruthy();

    const me = screen.getByTestId('leader-me');
    expect(within(me).getByText('Ravi Kumar (you)')).toBeTruthy();
    expect(me.props.accessibilityLabel).toBe('Rank 2, you, 6 check-ins');
    const style = Array.isArray(me.props.style) ? Object.assign({}, ...me.props.style) : me.props.style;
    expect(style.backgroundColor).not.toBe('transparent');

    fireEvent.press(screen.getByLabelText('Join challenge'));
    await waitFor(() => expect(api.setJoined).toHaveBeenCalledWith('gym-1', 'ch1', true));
    expect(await screen.findByLabelText('Leave challenge')).toBeTruthy();
    expect(screen.getByTestId('my-progress')).toBeTruthy();
    await waitFor(() => expect(api.leaderboard).toHaveBeenCalledTimes(2));
    await screen.findByText('Anita Desai');
  });

  it('marks finishers on the leaderboard', async () => {
    const api = makeFakeApi({
      leaderboard: async () => ({ entries: [{ rank: 1, user: { id: 'u2', name: 'Anita Desai' }, progress: 30, completed: true, isMe: false }] }),
    });
    renderApp(<ChallengeDetailScreen params={{ id: 'ch1' }} />, { api });
    expect(await screen.findByLabelText('Rank 1, Anita Desai, 30 check-ins, completed')).toBeTruthy();
  });
});
