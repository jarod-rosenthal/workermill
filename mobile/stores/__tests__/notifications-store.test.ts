import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '@/lib/api-client';
import { useNotificationsStore, NotificationPreferences } from '../notifications-store';
import { STORAGE_KEYS } from '@/constants/config';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@/lib/api-client');

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock data
const mockPreferences: NotificationPreferences = {
  push_completions: true,
  push_failures: true,
  push_blockers: false,
  push_plan_approvals: true,
};

const defaultPreferences: NotificationPreferences = {
  push_completions: true,
  push_failures: true,
  push_blockers: true,
  push_plan_approvals: true,
};

describe('Notifications Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset zustand store state
    useNotificationsStore.setState({
      preferences: null,
      isLoading: false,
      error: null,
      lastUpdated: null,
    });

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue();

    // Mock API client
    mockedApiClient.get.mockResolvedValue({ data: mockPreferences });
    mockedApiClient.put.mockResolvedValue({ data: mockPreferences });
  });

  describe('fetchPreferences', () => {
    it('should fetch preferences from API', async () => {
      const store = useNotificationsStore.getState();

      await store.fetchPreferences();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/push/prefs');
      expect(store.preferences).toEqual(mockPreferences);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.lastUpdated).toBeTruthy();
    });

    it('should use default preferences on fetch error', async () => {
      const error = new Error('Network error');
      mockedApiClient.get.mockRejectedValue(error);

      const store = useNotificationsStore.getState();

      await store.fetchPreferences();

      expect(store.preferences).toEqual(defaultPreferences);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBe('Network error');
      expect(store.lastUpdated).toBeTruthy();
    });

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockedApiClient.get.mockReturnValue(promise);

      const store = useNotificationsStore.getState();
      const fetchPromise = store.fetchPreferences();

      expect(store.isLoading).toBe(true);
      expect(store.error).toBeNull();

      resolvePromise!({ data: mockPreferences });
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });
  });

  describe('savePreferences', () => {
    beforeEach(() => {
      // Set initial preferences
      useNotificationsStore.getState().setPreferences(mockPreferences);
    });

    it('should save preferences to API', async () => {
      const store = useNotificationsStore.getState();
      const updates = { push_blockers: true };

      await store.savePreferences(updates);

      const expectedPrefs = { ...mockPreferences, ...updates };
      expect(mockedApiClient.put).toHaveBeenCalledWith('/push/prefs', expectedPrefs);
      expect(store.preferences).toEqual(expectedPrefs);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.lastUpdated).toBeTruthy();
    });

    it('should handle save errors', async () => {
      const error = new Error('Save failed');
      mockedApiClient.put.mockRejectedValue(error);

      const store = useNotificationsStore.getState();

      await expect(store.savePreferences({ push_blockers: true })).rejects.toThrow('Save failed');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBe('Save failed');
    });

    it('should throw error if no current preferences', async () => {
      const store = useNotificationsStore.getState();

      // Clear preferences
      store.setPreferences(null);

      await expect(store.savePreferences({ push_blockers: true }))
        .rejects.toThrow('No current preferences to update');
    });

    it('should set loading state during save', async () => {
      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockedApiClient.put.mockReturnValue(promise);

      const store = useNotificationsStore.getState();
      const savePromise = store.savePreferences({ push_blockers: true });

      expect(store.isLoading).toBe(true);
      expect(store.error).toBeNull();

      resolvePromise!({ data: mockPreferences });
      await savePromise;

      expect(store.isLoading).toBe(false);
    });
  });

  describe('togglePreference', () => {
    beforeEach(() => {
      useNotificationsStore.getState().setPreferences(mockPreferences);
    });

    it('should toggle preference value', async () => {
      const store = useNotificationsStore.getState();

      // Toggle push_blockers from false to true
      await store.togglePreference('push_blockers');

      expect(store.preferences!.push_blockers).toBe(true);
      expect(mockedApiClient.put).toHaveBeenCalledWith('/push/prefs', {
        ...mockPreferences,
        push_blockers: true,
      });
    });

    it('should revert on save error', async () => {
      const error = new Error('Save failed');
      mockedApiClient.put.mockRejectedValue(error);

      const store = useNotificationsStore.getState();
      const originalValue = store.preferences!.push_completions;

      await expect(store.togglePreference('push_completions')).rejects.toThrow('Save failed');

      // Should revert to original value
      expect(store.preferences!.push_completions).toBe(originalValue);
    });

    it('should throw error if no preferences loaded', async () => {
      const store = useNotificationsStore.getState();

      // Clear preferences
      store.setPreferences(null);

      await expect(store.togglePreference('push_completions'))
        .rejects.toThrow('No preferences loaded');
    });
  });

  describe('helper methods', () => {
    beforeEach(() => {
      useNotificationsStore.getState().setPreferences(mockPreferences);
    });

    it('should get preference value', () => {
      const store = useNotificationsStore.getState();

      expect(store.getPreference('push_completions')).toBe(true);
      expect(store.getPreference('push_blockers')).toBe(false);
    });

    it('should return default value when no preferences', () => {
      const store = useNotificationsStore.getState();

      // Clear preferences
      store.setPreferences(null);

      expect(store.getPreference('push_completions')).toBe(true); // default
      expect(store.getPreference('push_blockers')).toBe(true); // default
    });

    it('should check if preferences exist', () => {
      const store = useNotificationsStore.getState();

      expect(store.hasPreferences()).toBe(true);

      store.setPreferences(null);
      expect(store.hasPreferences()).toBe(false);
    });
  });

  describe('state management', () => {
    it('should set preferences', () => {
      const store = useNotificationsStore.getState();

      store.setPreferences(mockPreferences);

      expect(store.preferences).toEqual(mockPreferences);
      expect(store.lastUpdated).toBeTruthy();
      expect(store.error).toBeNull();
    });

    it('should update single preference', () => {
      const store = useNotificationsStore.getState();

      store.setPreferences(mockPreferences);
      store.updatePreference('push_blockers', true);

      expect(store.preferences!.push_blockers).toBe(true);
      expect(store.preferences!.push_completions).toBe(mockPreferences.push_completions); // unchanged
      expect(store.lastUpdated).toBeTruthy();
    });

    it('should not update preference if no current preferences', () => {
      const store = useNotificationsStore.getState();

      store.updatePreference('push_blockers', true);

      expect(store.preferences).toBeNull();
    });

    it('should set loading and error states', () => {
      const store = useNotificationsStore.getState();

      store.setLoading(true);
      expect(store.isLoading).toBe(true);

      store.setError('Test error');
      expect(store.error).toBe('Test error');
    });
  });

  describe('persistence', () => {
    it('should use correct AsyncStorage key', () => {
      // Verify the store uses the versioned key from config
      expect(STORAGE_KEYS.NOTIFICATIONS).toBe('wm-notifications-v1');
      expect(useNotificationsStore.persist).toBeDefined();
    });

    it('should persist only preferences and lastUpdated', () => {
      const store = useNotificationsStore.getState();

      store.setPreferences(mockPreferences);
      store.setLoading(true);
      store.setError('Test error');

      // The partialize function should only include specific fields
      const config = (useNotificationsStore as any).persist.getOptions();
      const partializedState = config.partialize(store);

      expect(partializedState).toHaveProperty('preferences');
      expect(partializedState).toHaveProperty('lastUpdated');
      expect(partializedState).not.toHaveProperty('isLoading');
      expect(partializedState).not.toHaveProperty('error');
    });
  });

  describe('convenience selectors', () => {
    it('should provide preference selectors', () => {
      const { useNotificationPreference, useNotificationPreferences } = jest.requireActual('../notifications-store');

      // These are tested through integration with the actual hook usage
      // The implementation just calls the store methods we've already tested
      expect(typeof useNotificationPreference).toBe('function');
      expect(typeof useNotificationPreferences).toBe('function');
    });
  });

  describe('default preferences', () => {
    it('should have correct default values', () => {
      const store = useNotificationsStore.getState();

      // When no preferences are loaded, getPreference should return defaults
      store.setPreferences(null);

      expect(store.getPreference('push_completions')).toBe(true);
      expect(store.getPreference('push_failures')).toBe(true);
      expect(store.getPreference('push_blockers')).toBe(true);
      expect(store.getPreference('push_plan_approvals')).toBe(true);
    });
  });

  describe('API integration', () => {
    it('should handle partial preference updates', async () => {
      const store = useNotificationsStore.getState();

      store.setPreferences(mockPreferences);

      const partialUpdate = { push_failures: false };
      await store.savePreferences(partialUpdate);

      const expectedFullUpdate = { ...mockPreferences, ...partialUpdate };
      expect(mockedApiClient.put).toHaveBeenCalledWith('/push/prefs', expectedFullUpdate);
      expect(store.preferences).toEqual(expectedFullUpdate);
    });

    it('should handle boolean preference types correctly', async () => {
      const store = useNotificationsStore.getState();

      store.setPreferences(mockPreferences);

      // Test toggling each preference type
      await store.togglePreference('push_completions');
      expect(store.preferences!.push_completions).toBe(false);

      await store.togglePreference('push_failures');
      expect(store.preferences!.push_failures).toBe(false);

      await store.togglePreference('push_blockers');
      expect(store.preferences!.push_blockers).toBe(true);

      await store.togglePreference('push_plan_approvals');
      expect(store.preferences!.push_plan_approvals).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle non-Error objects in catch blocks', async () => {
      const store = useNotificationsStore.getState();

      // Mock API to throw a string instead of Error object
      mockedApiClient.get.mockRejectedValue('String error');

      await store.fetchPreferences();

      expect(store.error).toBe('String error');
      expect(store.preferences).toEqual(defaultPreferences);
    });

    it('should clear error on successful operations', async () => {
      const store = useNotificationsStore.getState();

      // Set initial error state
      store.setError('Previous error');

      await store.fetchPreferences();

      expect(store.error).toBeNull();
    });
  });
});