import {
  isPushNotificationSupported,
  requestPushPermissions,
  getExpoPushToken,
  registerPushToken,
  unregisterPushToken,
  getNotificationPreferences,
  updateNotificationPreferences,
  setupNotificationListeners,
} from '../push';
import { tokenManager } from '../api-client';

// Mock expo-notifications
const mockNotifications = {
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
};

jest.mock('expo-notifications', () => mockNotifications);

// Mock expo-device
const mockDevice = {
  isDevice: true,
  deviceName: 'Test Device',
  brand: 'Test Brand',
  modelName: 'Test Model',
};

jest.mock('expo-device', () => mockDevice);

// Mock expo-secure-store
const mockSecureStore = {
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
};

jest.mock('expo-secure-store', () => mockSecureStore);

// Mock react-native Platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
}));

// Mock api-client tokenManager
jest.mock('../api-client', () => ({
  tokenManager: {
    getAccessToken: jest.fn(),
  },
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockTokenManager = tokenManager as jest.Mocked<typeof tokenManager>;

describe('Push Notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[test-token]' });
    mockTokenManager.getAccessToken.mockResolvedValue('test-access-token');
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockSecureStore.getItemAsync.mockResolvedValue('ExponentPushToken[stored-token]');
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);
  });

  describe('isPushNotificationSupported', () => {
    it('returns true on physical device', () => {
      mockDevice.isDevice = true;
      expect(isPushNotificationSupported()).toBe(true);
    });

    it('returns false on simulator', () => {
      mockDevice.isDevice = false;
      expect(isPushNotificationSupported()).toBe(false);
    });
  });

  describe('requestPushPermissions', () => {
    it('returns true when permissions are already granted', async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });

      const result = await requestPushPermissions();

      expect(result).toBe(true);
      expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('requests permissions when not granted and returns true on success', async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
      mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });

      const result = await requestPushPermissions();

      expect(result).toBe(true);
      expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    it('returns false when permission is denied', async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
      mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

      const result = await requestPushPermissions();

      expect(result).toBe(false);
    });

    it('returns false on simulator', async () => {
      mockDevice.isDevice = false;

      const result = await requestPushPermissions();

      expect(result).toBe(false);
      expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    });

    it('sets up Android notification channel', async () => {
      const { Platform } = require('react-native');
      Platform.OS = 'android';

      mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });

      await requestPushPermissions();

      expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
        name: 'WorkerMill',
        importance: mockNotifications.AndroidImportance?.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6366f1',
        sound: 'default',
      });
    });
  });

  describe('getExpoPushToken', () => {
    it('returns token when permissions are granted', async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
      mockNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[test]' });

      const token = await getExpoPushToken();

      expect(token).toBe('ExponentPushToken[test]');
      expect(mockNotifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
        projectId: '98e60e26-13c4-421e-b114-96a7b2523f35',
      });
    });

    it('returns null when permissions are denied', async () => {
      mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
      mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

      const token = await getExpoPushToken();

      expect(token).toBe(null);
      expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('returns null on simulator', async () => {
      mockDevice.isDevice = false;

      const token = await getExpoPushToken();

      expect(token).toBe(null);
    });
  });

  describe('registerPushToken', () => {
    it('registers token successfully', async () => {
      const mockResponse = {
        id: 'sub-123',
        expoPushToken: 'ExponentPushToken[test]',
        platform: 'android',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await registerPushToken();

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/push/register'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-access-token',
          },
          body: JSON.stringify({
            expoPushToken: 'ExponentPushToken[test-token]',
            platform: 'android',
            deviceName: 'Test Device',
          }),
        }
      );
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
        'expo_push_token',
        'ExponentPushToken[test-token]'
      );
    });

    it('returns null when no push token available', async () => {
      mockNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: null });

      const result = await registerPushToken();

      expect(result).toBe(null);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when no auth token available', async () => {
      mockTokenManager.getAccessToken.mockResolvedValue(null);

      const result = await registerPushToken();

      expect(result).toBe(null);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when registration fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      const result = await registerPushToken();

      expect(result).toBe(null);
    });

    it('uses fallback device name when device name is not available', async () => {
      mockDevice.deviceName = null;

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await registerPushToken();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({
            expoPushToken: 'ExponentPushToken[test-token]',
            platform: 'android',
            deviceName: 'Test Brand Test Model',
          }),
        })
      );
    });
  });

  describe('unregisterPushToken', () => {
    it('unregisters token successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await unregisterPushToken();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/push/register'),
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-access-token',
          },
          body: JSON.stringify({
            expoPushToken: 'ExponentPushToken[stored-token]',
          }),
        }
      );
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('expo_push_token');
    });

    it('returns true when no stored token exists', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      const result = await unregisterPushToken();

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('clears local token even when backend call fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      const result = await unregisterPushToken();

      expect(result).toBe(true); // Still returns true after clearing local token
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('expo_push_token');
    });

    it('handles missing auth token gracefully', async () => {
      mockTokenManager.getAccessToken.mockResolvedValue(null);

      const result = await unregisterPushToken();

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('expo_push_token');
    });
  });

  describe('getNotificationPreferences', () => {
    it('fetches preferences successfully', async () => {
      const mockPrefs = {
        push_completions: true,
        push_failures: true,
        push_blockers: false,
        push_plan_approvals: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPrefs),
      });

      const result = await getNotificationPreferences();

      expect(result).toEqual(mockPrefs);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/push/prefs'),
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-access-token',
          },
        }
      );
    });

    it('returns null when no auth token available', async () => {
      mockTokenManager.getAccessToken.mockResolvedValue(null);

      const result = await getNotificationPreferences();

      expect(result).toBe(null);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      const result = await getNotificationPreferences();

      expect(result).toBe(null);
    });
  });

  describe('updateNotificationPreferences', () => {
    it('updates preferences successfully', async () => {
      const inputPrefs = { push_completions: false };
      const mockResponse = {
        push_completions: false,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await updateNotificationPreferences(inputPrefs);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/push/prefs'),
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-access-token',
          },
          body: JSON.stringify(inputPrefs),
        }
      );
    });

    it('returns null when no auth token available', async () => {
      mockTokenManager.getAccessToken.mockResolvedValue(null);

      const result = await updateNotificationPreferences({});

      expect(result).toBe(null);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('setupNotificationListeners', () => {
    it('sets up foreground and response listeners', () => {
      const mockRemove1 = jest.fn();
      const mockRemove2 = jest.fn();

      mockNotifications.addNotificationReceivedListener.mockReturnValue({ remove: mockRemove1 });
      mockNotifications.addNotificationResponseReceivedListener.mockReturnValue({ remove: mockRemove2 });

      const listeners = setupNotificationListeners();

      expect(mockNotifications.addNotificationReceivedListener).toHaveBeenCalled();
      expect(mockNotifications.addNotificationResponseReceivedListener).toHaveBeenCalled();

      // Test remove functionality
      listeners.remove();
      expect(mockRemove1).toHaveBeenCalled();
      expect(mockRemove2).toHaveBeenCalled();
    });
  });
});