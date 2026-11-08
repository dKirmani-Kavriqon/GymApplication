import { ApiError, createApi } from './client';

function fakeFetch(status: number, body: unknown) {
  return jest.fn(async () => ({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) }) as unknown as Response);
}

describe('api client', () => {
  it('sends the bearer token and JSON body', async () => {
    const f = fakeFetch(201, { alreadyCheckedIn: false });
    const api = createApi('http://api', () => 'tok', f);
    await api.checkIn('gym 1');
    expect(f).toHaveBeenCalledWith('http://api/gyms/gym%201/checkins', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'button' }),
    });
  });

  it('omits auth when signed out', async () => {
    const f = fakeFetch(200, { name: 'Flex' });
    await createApi('http://api', () => null, f).previewGym('FLEX42');
    expect((f.mock.calls[0] as unknown[])[1]).toEqual({ method: 'GET', headers: {}, body: undefined });
  });

  it('turns API errors into ApiError with the server message', async () => {
    const api = createApi('http://api', () => 'tok', fakeFetch(409, { error: 'class_started', message: 'This class has already started.' }));
    await expect(api.book('g', 'c')).rejects.toEqual(expect.objectContaining({ status: 409, code: 'class_started', message: 'This class has already started.' }));
  });

  it('reports network failures in plain words', async () => {
    const f = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const err = await createApi('http://api', () => null, f as unknown as typeof fetch).me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/No internet connection/);
  });
});
