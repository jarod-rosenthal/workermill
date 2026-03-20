import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { PushNotificationManager } from '../push';
import { apiClient } from '../api-client';

// Mock dependencies
jest.mock('expo-notifications');
jest.mock('expo-device');
jest.mock('expo-secure-store');
jest.mock('../api-client');
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;
const mockedDevice = Device as jest.Mocked<typeof Device>;
const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('PushNotificationManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks using mockImplementation
    Object.defineProperty(mockedDevice, 'isDevice', { value: true, writable: true });
    Object.defineProperty(mockedDevice, 'deviceName', { value: 'iPhone 14', writable: true });
    Object.defineProperty(mockedDevice, 'brand', { value: 'Apple', writable: true });
    Object.defineProperty(mockedDevice, 'modelName', { value: 'iPhone', writable: true });
  });

  describe('isSupported', () => {
    it('should return true for physical iOS device', async () => {
      Object.defineProperty(mockedDevice, 'isDevice', { value: true, writable: true });
      (Platform.OS as any) = 'ios';

      const isSupported = await PushNotificationManager.isSupported();
      expect(isSupported).toBe(true);
    });

    it('should return true for physical Android device', async () => {
      Object.defineProperty(mockedDevice, 'isDevice', { value: true, writable: true });
      (Platform.OS as any) = 'android';

      const isSupported = await PushNotificationManager.isSupported();
      expect(isSupported).toBe(true);
    });

    it('should return false for simulator/emulator', async () => {
      Object.defineProperty(mockedDevice, 'isDevice', { value: false, writable: true });

      const isSupported = await PushNotificationManager.isSupported();
      expect(isSupported).toBe(false);
    });

    it('should return false for unsupported platform', async () => {
      Object.defineProperty(mockedDevice, 'isDevice', { value: true, writable: true });
      (Platform.OS as any) = 'web';

      const isSupported = await PushNotificationManager.isSupported();
      expect(isSupported).toBe(false);
    });
  });

  describe('requestPermissionsAndGetToken', () => {
    it('should request permissions and return push token when granted', async () => {
      const mockToken = 'ExponentPushToken[test-token]';

      mockedNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'undetermined',
      } as any);

      mockedNotifications.requestPermissionsAsync.mockResolvedValue({
        status: 'granted',
      } as any);

      mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({
        data: mockToken,
      } as any);

      const result = await PushNotificationManager.requestPermissionsAndGetToken();

      expect(mockedNotifications.getPermissionsAsync).toHaveBeenCalled();
      expect(mockedNotifications.requestPermissionsAsync).toHaveBeenCalled();
      expect(mockedNotifications.getExpoPushTokenAsync).toHaveBeenCalled();
      expect(result).toBe(mockToken);
    });

    it('should return token without requesting if already granted', async () => {
      const mockToken = 'ExponentPushToken[test-token]';

      mockedNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'granted',
      } as any);

      mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({
        data: mockToken,
      } as any);

      const result = await PushNotificationManager.requestPermissionsAndGetToken();

      expect(mockedNotifications.getPermissionsAsync).toHaveBeenCalled();
      expect(mockedNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
      expect(result).toBe(mockToken);
    });

    it('should return null when permission is denied', async () => {
      mockedNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'undetermined',
      } as any);

      mockedNotifications.requestPermissionsAsync.mockResolvedValue({
        status: 'denied',
      } as any);

      const result = await PushNotificationManager.requestPermissionsAndGetToken();

      expect(result).toBe(null);
      expect(mockedNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('should return null for unsupported device', async () => {
      Object.defineProperty(mockedDevice, 'isDevice', { value: false, writable: true });

      const result = await PushNotificationManager.requestPermissionsAndGetToken();

      expect(result).toBe(null);
    });
  });

  describe('registerPushToken', () => {
    it('should register push token successfully', async () => {
      const mockToken = 'ExponentPushToken[test-token]';

      // Mock permission and token retrieval
      mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
      mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: mockToken } as any);

      // Mock API response
      mockedApiClient.post.mockResolvedValue({ id: 'subscription-id' });

      const result = await PushNotificationManager.registerPushToken();

      expect(mockedApiClient.post).toHaveBeenCalledWith('/push/register', {
        expoPushToken: mockToken,
        platform: 'ios',
        deviceName: 'iPhone 14',
      });

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'expo_push_token',
        mockToken
      );

      expect(result).toBe(true);
    });

    it('should return false when token retrieval fails', async () => {
      mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);

      const result = await PushNotificationManager.registerPushToken();

      expect(result).toBe(false);
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });

    it('should return false when API registration fails', async () => {
      const mockToken = 'ExponentPushToken[test-token]';

      mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
      mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: mockToken } as any);

      mockedApiClient.post.mockRejectedValue(new Error('API error'));

      const result = await PushNotificationManager.registerPushToken();

      expect(result).toBe(false);
    });
  });

  describe('unregisterPushToken', () => {
    it('should unregister stored push token successfully', async () => {
      const mockToken = 'ExponentPushToken[test-token]';

      mockedSecureStore.getItemAsync.mockResolvedValue(mockToken);
      mockedApiClient.delete.mockResolvedValue({ success: true });

      const result = await PushNotificationManager.unregisterPushToken();

      expect(mockedApiClient.delete).toHaveBeenCalledWith('/push/register', {
        data: { expoPushToken: mockToken },
      });

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('expo_push_token');
      expect(result).toBe(true);
    });

    it('should return true when no token is stored', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      const result = await PushNotificationManager.unregisterPushToken();

      expect(result).toBe(true);
      expect(mockedApiClient.delete).not.toHaveBeenCalled();
    });

    it('should return false when API unregistration fails', async () => {
      const mockToken = 'ExponentPushToken[test-token]';

      mockedSecureStore.getItemAsync.mockResolvedValue(mockToken);
      mockedApiClient.delete.mockRejectedValue(new Error('API error'));

      const result = await PushNotificationManager.unregisterPushToken();

      expect(result).toBe(false);
    });
  });

  describe('notification preferences', () => {
    it('should get notification preferences successfully', async () => {
      const mockPreferences = {
        push_completions: true,
        push_failures: true,
        push_blockers: false,
        push_plan_approvals: true,
      };

      mockedApiClient.get.mockResolvedValue(mockPreferences);

      const result = await PushNotificationManager.getNotificationPreferences();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/push/prefs');
      expect(result).toEqual(mockPreferences);
    });

    it('should return default preferences when API call fails', async () => {
      mockedApiClient.get.mockRejectedValue(new Error('API error'));

      const result = await PushNotificationManager.getNotificationPreferences();

      expect(result).toEqual({
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      });
    });

    it('should update notification preferences successfully', async () => {
      const updatedPreferences = {
        push_completions: false,
        push_failures: true,
        push_blockers: false,
        push_plan_approvals: true,
      };

      const partialUpdate = { push_completions: false };

      mockedApiClient.put.mockResolvedValue(updatedPreferences);

      const result = await PushNotificationManager.updateNotificationPreferences(partialUpdate);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/push/prefs', partialUpdate);
      expect(result).toEqual(updatedPreferences);
    });

    it('should filter preferences by category', async () => {
      const allPreferences = {
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      };

      mockedApiClient.get.mockResolvedValue(allPreferences);

      const result = await PushNotificationManager.getNotificationPreferences();

      // Verify all expected categories are present
      expect(result).toHaveProperty('push_completions');
      expect(result).toHaveProperty('push_failures');
      expect(result).toHaveProperty('push_blockers');
      expect(result).toHaveProperty('push_plan_approvals');
    });
  });

  describe('isPushEnabled', () => {
    it('should return true when permissions granted and token stored', async () => {
      mockedNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'granted',
      } as any);

      mockedSecureStore.getItemAsync.mockResolvedValue('ExponentPushToken[test-token]');

      const result = await PushNotificationManager.isPushEnabled();

      expect(result).toBe(true);
    });

    it('should return false when permissions denied', async () => {
      mockedNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'denied',
      } as any);

      mockedSecureStore.getItemAsync.mockResolvedValue('ExponentPushToken[test-token]');

      const result = await PushNotificationManager.isPushEnabled();

      expect(result).toBe(false);
    });

    it('should return false when no token stored', async () => {
      mockedNotifications.getPermissionsAsync.mockResolvedValue({
        status: 'granted',
      } as any);

      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      const result = await PushNotificationManager.isPushEnabled();

      expect(result).toBe(false);
    });
  });

  describe('notification listeners', () => {
    it('should add notification response listener', () => {
      const mockSubscription = { remove: jest.fn() };
      const mockListener = jest.fn();

      mockedNotifications.addNotificationResponseReceivedListener.mockReturnValue(
        mockSubscription as any
      );

      const subscription = PushNotificationManager.addNotificationResponseListener(mockListener);

      expect(mockedNotifications.addNotificationResponseReceivedListener).toHaveBeenCalledWith(
        mockListener
      );
      expect(subscription).toBe(mockSubscription);
    });

    it('should add notification received listener', () => {
      const mockSubscription = { remove: jest.fn() };
      const mockListener = jest.fn();

      mockedNotifications.addNotificationReceivedListener.mockReturnValue(
        mockSubscription as any
      );

      const subscription = PushNotificationManager.addNotificationReceivedListener(mockListener);

      expect(mockedNotifications.addNotificationReceivedListener).toHaveBeenCalledWith(
        mockListener
      );
      expect(subscription).toBe(mockSubscription);
    });

    it('should remove all notification listeners', () => {
      // Mock the method since it might not exist in all versions
      (mockedNotifications as any).removeAllNotificationListeners = jest.fn();

      PushNotificationManager.removeAllNotificationListeners();

      expect((mockedNotifications as any).removeAllNotificationListeners).toHaveBeenCalled();
    });
  });

  describe('permission management', () => {
    it('should get permission status', async () => {
      const mockStatus = { status: 'granted' };
      mockedNotifications.getPermissionsAsync.mockResolvedValue(mockStatus as any);

      const result = await PushNotificationManager.getPermissionStatus();

      expect(mockedNotifications.getPermissionsAsync).toHaveBeenCalled();
      expect(result).toBe(mockStatus);
    });

    it('should open notification settings', async () => {
      // Mock the method since it might not exist in all versions
      (mockedNotifications as any).openSettingsAsync = jest.fn();

      await PushNotificationManager.openNotificationSettings();

      expect((mockedNotifications as any).openSettingsAsync).toHaveBeenCalled();
    });
  });
});