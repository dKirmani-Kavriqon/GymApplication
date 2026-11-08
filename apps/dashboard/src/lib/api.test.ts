import { installFakeApi, apiError } from '../test/fakeApi';
import { API_URL, ApiError, api, errorMessage, getToken, onUnauthorized, setToken } from './api';
import { TOKEN_KEY, readStorage, writeStorage } from './storage';

describe('api client', () => {
  it('defaults to localhost:4000', () => {
    expect(API_URL).toBe('http://localhost:4000');
  });

  it('sends JSON with the bearer token', async () => {
    setToken('tok-123');
    const fake = installFakeApi({ 'POST /gyms': (req) => ({ echo: req.body }) });
    const res = await api.post<{ echo: unknown }>('/gyms', { name: 'X' });
    expect(res.echo).toEqual({ name: 'X' });
    const [url, init] = fake.fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:4000/gyms');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiError carrying the API message', async () => {
    installFakeApi({ 'GET /me': apiError(403, 'You do not have access.', 'forbidden') });
    const err = (await api.get('/me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('forbidden');
    expect(errorMessage(err)).toBe('You do not have access.');
  });

  it('handles 204 empty bodies', async () => {
    installFakeApi({ 'DELETE /gyms/:gymId/plans/:id': { status: 204 } });
    await expect(api.del('/gyms/g/plans/p')).resolves.toBeUndefined();
  });

  it('reports network failures in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.get('/me')).rejects.toThrow(/Could not reach the GymVerse server/);
  });

  it('calls the unauthorized handler on 401 when logged in', async () => {
    setToken('old');
    const handler = vi.fn();
    onUnauthorized(handler);
    installFakeApi({ 'GET /me': apiError(401, 'Please log in again.', 'unauthorized') });
    await expect(api.get('/me')).rejects.toThrow('Please log in again.');
    expect(handler).toHaveBeenCalledTimes(1);
    onUnauthorized(null);
  });
});

describe('storage', () => {
  it('round-trips the token', () => {
    setToken('abc');
    expect(getToken()).toBe('abc');
    expect(readStorage(TOKEN_KEY)).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => writeStorage('k', 'v')).not.toThrow();
    expect(readStorage('k')).toBeNull();
  });
});
