import * as Notifications from 'expo-notifications';
import { registerForPush } from './push';
import { makeFakeApi } from '../test/fakeApi';

const device = jest.requireMock('expo-device') as { isDevice: boolean };
const notifications = Notifications as unknown as Record<string, jest.Mock>;

describe('push registration', () => {
  afterEach(() => {
    device.isDevice = false;
    jest.clearAllMocks();
  });

  it('does nothing on simulators', async () => {
    const api = makeFakeApi();
    expect(await registerForPush(api as never)).toBeNull();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('respects a declined permission', async () => {
    device.isDevice = true;
    const api = makeFakeApi();
    expect(await registerForPush(api as never, 'proj-123')).toBeNull();
    expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('registers the Expo push token when allowed', async () => {
    device.isDevice = true;
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: true });
    const api = makeFakeApi();
    expect(await registerForPush(api as never, 'proj-123')).toBe('ExponentPushToken[test]');
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(api.registerDevice).toHaveBeenCalledWith('ExponentPushToken[test]', 'ios');
  });

  it('never throws if push setup fails', async () => {
    device.isDevice = true;
    notifications.getPermissionsAsync.mockRejectedValueOnce(new Error('boom'));
    expect(await registerForPush(makeFakeApi() as never, 'proj-123')).toBeNull();
  });
});
