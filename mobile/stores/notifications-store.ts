import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/lib/api-client';
import { STORAGE_KEYS } from '@/constants/config';

export interface NotificationPreferences {
  push_completions: boolean;
  push_failures: boolean;
  push_blockers: boolean;
  push_plan_approvals: boolean;
}

export interface NotificationsState {
  // Data
  preferences: NotificationPreferences | null;
  lastUpdated: string | null;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Actions
  loadPreferences: () => Promise<void>;
  updatePreferences: (preferences: Partial<NotificationPreferences>) => Promise<void>;
  resetPreferences: () => void;

  // Convenience getters
  isEnabled: (category: keyof NotificationPreferences) => boolean;
  getEnabledCategories: () => (keyof NotificationPreferences)[];
}

// Default preferences
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
      preferences: DEFAULT_PREFERENCES,
      lastUpdated: null,
      isLoading: false,
      error: null,

      // Actions
      loadPreferences: async () => {
        set({ isLoading: true, error: null });

        try {
          const preferences = await apiClient.get<NotificationPreferences>('/push/prefs');

          set({
            preferences,
            lastUpdated: new Date().toISOString(),
            isLoading: false,
            error: null
          });
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to load notification preferences';
          set({
            isLoading: false,
            error: errorMessage
          });
          throw error;
        }
      },

      updatePreferences: async (updates: Partial<NotificationPreferences>) => {
        const currentPrefs = get().preferences || DEFAULT_PREFERENCES;

        set({ isLoading: true, error: null });

        try {
          const preferences = await apiClient.put<NotificationPreferences>('/push/prefs', updates);

          set({
            preferences,
            lastUpdated: new Date().toISOString(),
            isLoading: false,
            error: null
          });
        } catch (error: any) {
          const errorMessage = error.response?.data?.message || 'Failed to update notification preferences';
          set({
            isLoading: false,
            error: errorMessage
          });

          // Revert optimistic update on error
          set({ preferences: currentPrefs });
          throw error;
        }
      },

      resetPreferences: () => {
        set({
          preferences: DEFAULT_PREFERENCES,
          lastUpdated: new Date().toISOString(),
          error: null
        });
      },

      // Convenience getters
      isEnabled: (category: keyof NotificationPreferences) => {
        const preferences = get().preferences || DEFAULT_PREFERENCES;
        return preferences[category];
      },

      getEnabledCategories: () => {
        const preferences = get().preferences || DEFAULT_PREFERENCES;
        return Object.entries(preferences)
          .filter(([_, enabled]) => enabled)
          .map(([category]) => category as keyof NotificationPreferences);
      },
    }),
    {
      name: STORAGE_KEYS.NOTIFICATIONS,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist data, not loading states
      partialize: (state) => ({
        preferences: state.preferences,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);