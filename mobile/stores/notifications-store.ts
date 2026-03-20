import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '@/lib/api-client';
import { STORAGE_KEYS } from '@/constants/config';

// Push notification preferences interface
export interface NotificationPreferences {
  push_completions: boolean;
  push_failures: boolean;
  push_blockers: boolean;
  push_plan_approvals: boolean;
}

// Notifications store state interface
interface NotificationsState {
  // Data
  preferences: NotificationPreferences | null;

  // UI state
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;

  // Actions
  setPreferences: (preferences: NotificationPreferences) => void;
  updatePreference: (key: keyof NotificationPreferences, value: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // API methods
  fetchPreferences: () => Promise<void>;
  savePreferences: (preferences: Partial<NotificationPreferences>) => Promise<void>;
  togglePreference: (key: keyof NotificationPreferences) => Promise<void>;

  // Helper methods
  getPreference: (key: keyof NotificationPreferences) => boolean;
  hasPreferences: () => boolean;
}

// Default notification preferences
const DEFAULT_PREFERENCES: NotificationPreferences = {
  push_completions: true,
  push_failures: true,
  push_blockers: true,
  push_plan_approvals: true,
};

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      // Initial state
      preferences: null,
      isLoading: false,
      error: null,
      lastUpdated: null,

      // Basic setters
      setPreferences: (preferences) =>
        set({
          preferences,
          lastUpdated: new Date().toISOString(),
          error: null,
        }),

      updatePreference: (key, value) =>
        set((state) => {
          if (!state.preferences) return state;

          return {
            preferences: {
              ...state.preferences,
              [key]: value,
            },
            lastUpdated: new Date().toISOString(),
          };
        }),

      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),

      // Fetch preferences from server
      fetchPreferences: async () => {
        try {
          set({ isLoading: true, error: null });

          const response = await apiClient.get('/push/prefs');
          const preferences = response.data;

          set({
            preferences,
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Failed to fetch notification preferences:', error);

          // Use default preferences if fetch fails
          set({
            preferences: DEFAULT_PREFERENCES,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to load preferences',
            lastUpdated: new Date().toISOString(),
          });
        }
      },

      // Save preferences to server
      savePreferences: async (updates: Partial<NotificationPreferences>) => {
        const currentPrefs = get().preferences;

        if (!currentPrefs) {
          throw new Error('No current preferences to update');
        }

        try {
          set({ isLoading: true, error: null });

          const updatedPrefs = { ...currentPrefs, ...updates };

          await apiClient.put('/push/prefs', updatedPrefs);

          set({
            preferences: updatedPrefs,
            isLoading: false,
            error: null,
            lastUpdated: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Failed to save notification preferences:', error);
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to save preferences',
          });
          throw error;
        }
      },

      // Toggle a specific preference
      togglePreference: async (key: keyof NotificationPreferences) => {
        const currentPrefs = get().preferences;

        if (!currentPrefs) {
          throw new Error('No preferences loaded');
        }

        const currentValue = currentPrefs[key];
        const newValue = !currentValue;

        try {
          // Update locally first for immediate UI feedback
          get().updatePreference(key, newValue);

          // Then save to server
          await get().savePreferences({ [key]: newValue });
        } catch (error) {
          // Revert local change on server error
          get().updatePreference(key, currentValue);
          throw error;
        }
      },

      // Helper methods
      getPreference: (key: keyof NotificationPreferences) => {
        const preferences = get().preferences;
        if (!preferences) {
          return DEFAULT_PREFERENCES[key];
        }
        return preferences[key];
      },

      hasPreferences: () => {
        return get().preferences !== null;
      },
    }),
    {
      name: STORAGE_KEYS.NOTIFICATIONS,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not loading/error states
      partialize: (state) => ({
        preferences: state.preferences,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);

// Convenience selectors
export const useNotificationPreference = (key: keyof NotificationPreferences) => {
  return useNotificationsStore((state) => state.getPreference(key));
};

export const useNotificationPreferences = () => {
  return useNotificationsStore((state) => state.preferences);
};

// Export store actions for external use
export const notificationsActions = {
  fetchPreferences: () => useNotificationsStore.getState().fetchPreferences(),
  savePreferences: (preferences: Partial<NotificationPreferences>) =>
    useNotificationsStore.getState().savePreferences(preferences),
  togglePreference: (key: keyof NotificationPreferences) =>
    useNotificationsStore.getState().togglePreference(key),
};

