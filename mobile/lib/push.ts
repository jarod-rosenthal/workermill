import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_BASE_URL } from '@/constants/config';
import { tokenManager } from './api-client';

// Storage key for push token
const PUSH_TOKEN_KEY = 'expo_push_token';

// Types
export interface PushSubscription {
  id: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  deviceName?: string;
}

export interface NotificationPreferences {
  push_completions: boolean;
  push_failures: boolean;
  push_blockers: boolean;
  push_plan_approvals: boolean;
}

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Check if device supports push notifications
 */
export const isPushNotificationSupported = (): boolean => {
  return Device.isDevice; // Must be physical device, not simulator
};

/**
 * Request push notification permissions
 */
export const requestPushPermissions = async (): Promise<boolean> => {
  if (!isPushNotificationSupported()) {
    console.warn('Push notifications are not supported on this device (simulator)');
    return false;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission denied');
      return false;
    }

    // Configure notification channel for Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'WorkerMill',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6366f1',
        sound: 'default',
      });
    }

    return true;
  } catch (error) {
    console.error('Failed to request push permissions:', error);
    return false;
  }
};

/**
 * Get Expo push token for this device
 */
export const getExpoPushToken = async (): Promise<string | null> => {
  try {
    if (!isPushNotificationSupported()) {
      return null;
    }

    // Check if we have permissions
    const hasPermissions = await requestPushPermissions();
    if (!hasPermissions) {
      return null;
    }

    // Get the token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '98e60e26-13c4-421e-b114-96a7b2523f35', // From app.json
    });

    return tokenData.data;
  } catch (error) {
    console.error('Failed to get Expo push token:', error);
    return null;
  }
};

/**
 * Register push token with backend
 */
export const registerPushToken = async (): Promise<PushSubscription | null> => {
  try {
    // Get push token
    const expoPushToken = await getExpoPushToken();
    if (!expoPushToken) {
      console.warn('No push token available for registration');
      return null;
    }

    // Get auth token
    const accessToken = await tokenManager.getAccessToken();
    if (!accessToken) {
      console.warn('No auth token available for push registration');
      return null;
    }

    // Get device info
    const platform = Platform.OS as 'ios' | 'android';
    const deviceName = Device.deviceName || `${Device.brand} ${Device.modelName}`.trim();

    // Register with backend
    const response = await fetch(`${API_BASE_URL}/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        expoPushToken,
        platform,
        deviceName: deviceName || undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to register push token: ${response.status} ${errorText}`);
    }

    const subscription = await response.json();

    // Store token securely for later unregistration
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, expoPushToken);

    console.log('Push token registered successfully:', subscription.id);
    return subscription;
  } catch (error) {
    console.error('Failed to register push token:', error);
    return null;
  }
};

/**
 * Unregister push token from backend
 */
export const unregisterPushToken = async (): Promise<boolean> => {
  try {
    // Get stored push token
    const expoPushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (!expoPushToken) {
      console.warn('No push token found to unregister');
      return true; // Consider this success - nothing to unregister
    }

    // Get auth token
    const accessToken = await tokenManager.getAccessToken();
    if (!accessToken) {
      console.warn('No auth token available for push unregistration');
      // Still clear local token even if we can't notify backend
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
      return false;
    }

    // Unregister from backend
    const response = await fetch(`${API_BASE_URL}/push/register`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        expoPushToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`Failed to unregister push token: ${response.status} ${errorText}`);
      // Continue to clear local token even if backend call failed
    }

    // Clear stored token
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);

    console.log('Push token unregistered successfully');
    return true;
  } catch (error) {
    console.error('Failed to unregister push token:', error);

    // Try to clear local token anyway
    try {
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
    } catch (clearError) {
      console.error('Failed to clear stored push token:', clearError);
    }

    return false;
  }
};

/**
 * Get current notification preferences
 */
export const getNotificationPreferences = async (): Promise<NotificationPreferences | null> => {
  try {
    const accessToken = await tokenManager.getAccessToken();
    if (!accessToken) {
      console.warn('No auth token available for preferences fetch');
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/push/prefs`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to get preferences: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get notification preferences:', error);
    return null;
  }
};

/**
 * Update notification preferences
 */
export const updateNotificationPreferences = async (
  preferences: Partial<NotificationPreferences>
): Promise<NotificationPreferences | null> => {
  try {
    const accessToken = await tokenManager.getAccessToken();
    if (!accessToken) {
      console.warn('No auth token available for preferences update');
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/push/prefs`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(preferences),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to update preferences: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to update notification preferences:', error);
    return null;
  }
};

/**
 * Get the stored push token (for debugging/display)
 */
export const getStoredPushToken = async (): Promise<string | null> => {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch (error) {
    console.error('Failed to get stored push token:', error);
    return null;
  }
};

/**
 * Set up notification listeners
 */
export const setupNotificationListeners = () => {
  // Handle notifications received while app is foregrounded
  const foregroundSubscription = Notifications.addNotificationReceivedListener(notification => {
    console.log('Notification received in foreground:', notification);
  });

  // Handle user tapping on notifications
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
    console.log('Notification response received:', response);

    // Extract deep link data
    const data = response.notification.request.content.data;
    if (data && typeof data === 'object') {
      handleNotificationTap(data);
    }
  });

  return {
    remove: () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    },
  };
};

/**
 * Handle notification tap - navigate to appropriate screen
 */
const handleNotificationTap = (data: Record<string, any>) => {
  // This will be implemented in the deep-linking.ts file
  // For now, just log the data
  console.log('Notification tap data:', data);
};