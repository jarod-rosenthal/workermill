import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiClient } from './api-client';

// Secure store key for push token
const PUSH_TOKEN_KEY = 'expo_push_token';

export interface PushNotificationPreferences {
  push_completions: boolean;
  push_failures: boolean;
  push_blockers: boolean;
  push_plan_approvals: boolean;
}

export interface PushRegistrationData {
  expoPushToken: string;
  platform: 'ios' | 'android';
  deviceName?: string;
}

export class PushNotificationManager {
  /**
   * Configure notification handling
   */
  static configure(): void {
    // Set the notification handler for when the app is in foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }

  /**
   * Check if push notifications are supported on this device
   */
  static async isSupported(): Promise<boolean> {
    return Device.isDevice && (Platform.OS === 'ios' || Platform.OS === 'android');
  }

  /**
   * Get device information for registration
   */
  private static async getDeviceInfo(): Promise<{ platform: 'ios' | 'android'; deviceName?: string }> {
    const platform = Platform.OS as 'ios' | 'android';
    let deviceName: string | undefined;

    try {
      deviceName = Device.deviceName || `${Device.brand} ${Device.modelName}` || undefined;
    } catch (error) {
      console.warn('Could not get device name:', error);
    }

    return { platform, deviceName };
  }

  /**
   * Request notification permissions and get Expo push token
   */
  static async requestPermissionsAndGetToken(): Promise<string | null> {
    try {
      if (!await this.isSupported()) {
        throw new Error('Push notifications are not supported on this device');
      }

      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        throw new Error('Push notification permission denied');
      }

      // Get Expo push token
      const tokenData = await Notifications.getExpoPushTokenAsync();
      return tokenData.data;
    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }
  }

  /**
   * Register push token with the API
   */
  static async registerPushToken(): Promise<boolean> {
    try {
      const expoPushToken = await this.requestPermissionsAndGetToken();
      if (!expoPushToken) {
        throw new Error('Failed to get push token');
      }

      const deviceInfo = await this.getDeviceInfo();

      const registrationData: PushRegistrationData = {
        expoPushToken,
        ...deviceInfo,
      };

      await apiClient.post('/push/register', registrationData);

      // Store token locally for unregistration later
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, expoPushToken);

      console.log('Push token registered successfully');
      return true;
    } catch (error) {
      console.error('Failed to register push token:', error);
      return false;
    }
  }

  /**
   * Unregister push token from the API
   */
  static async unregisterPushToken(): Promise<boolean> {
    try {
      const storedToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
      if (!storedToken) {
        console.log('No push token to unregister');
        return true;
      }

      await apiClient.delete('/push/register', {
        data: { expoPushToken: storedToken },
      });

      // Remove stored token
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);

      console.log('Push token unregistered successfully');
      return true;
    } catch (error) {
      console.error('Failed to unregister push token:', error);
      return false;
    }
  }

  /**
   * Get current notification preferences
   */
  static async getNotificationPreferences(): Promise<PushNotificationPreferences> {
    try {
      const preferences = await apiClient.get<PushNotificationPreferences>('/push/prefs');
      return preferences;
    } catch (error) {
      console.error('Failed to get notification preferences:', error);
      // Return default preferences on error
      return {
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      };
    }
  }

  /**
   * Update notification preferences
   */
  static async updateNotificationPreferences(
    preferences: Partial<PushNotificationPreferences>
  ): Promise<PushNotificationPreferences> {
    try {
      const updatedPreferences = await apiClient.put<PushNotificationPreferences>(
        '/push/prefs',
        preferences
      );
      return updatedPreferences;
    } catch (error) {
      console.error('Failed to update notification preferences:', error);
      throw error;
    }
  }

  /**
   * Re-register push token if it has changed since last registration.
   * Call on app startup after auth is confirmed.
   */
  static async syncPushToken(): Promise<void> {
    try {
      if (!await this.isSupported()) return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;

      const tokenData = await Notifications.getExpoPushTokenAsync();
      const currentToken = tokenData.data;
      const storedToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);

      if (currentToken !== storedToken) {
        console.log('Push token changed, re-registering...');
        await this.registerPushToken();
      }
    } catch (error) {
      console.warn('Push token sync failed:', error);
    }
  }

  /**
   * Get the stored push token
   */
  static async getStoredPushToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    } catch (error) {
      console.error('Failed to get stored push token:', error);
      return null;
    }
  }

  /**
   * Check if push notifications are currently enabled (permissions + token registered)
   */
  static async isPushEnabled(): Promise<boolean> {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const hasStoredToken = !!(await this.getStoredPushToken());

      return status === 'granted' && hasStoredToken;
    } catch (error) {
      console.error('Error checking push status:', error);
      return false;
    }
  }

  /**
   * Add notification response listener for handling taps
   */
  static addNotificationResponseListener(
    listener: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(listener);
  }

  /**
   * Add notification received listener for foreground notifications
   */
  static addNotificationReceivedListener(
    listener: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(listener);
  }

  /**
   * Remove all notification listeners
   */
  static removeAllNotificationListeners(): void {
    // Note: removeAllNotificationListeners may not be available in all versions
    if ('removeAllNotificationListeners' in Notifications) {
      (Notifications as any).removeAllNotificationListeners();
    }
  }

  /**
   * Get current notification permission status
   */
  static async getPermissionStatus(): Promise<Notifications.NotificationPermissionsStatus> {
    return await Notifications.getPermissionsAsync();
  }

  /**
   * Open device notification settings
   */
  static async openNotificationSettings(): Promise<void> {
    // Note: openSettingsAsync may not be available in all versions
    if ('openSettingsAsync' in Notifications) {
      await (Notifications as any).openSettingsAsync();
    }
  }
}

// Export convenience functions for common usage patterns
export const registerPushToken = PushNotificationManager.registerPushToken;
export const unregisterPushToken = PushNotificationManager.unregisterPushToken;
export const getNotificationPreferences = PushNotificationManager.getNotificationPreferences;
export const updateNotificationPreferences = PushNotificationManager.updateNotificationPreferences;
export const isPushEnabled = PushNotificationManager.isPushEnabled;
export const syncPushToken = PushNotificationManager.syncPushToken.bind(PushNotificationManager);