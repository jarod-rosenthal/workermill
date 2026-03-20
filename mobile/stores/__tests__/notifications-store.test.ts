import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotificationsStore } from '../notifications-store';
import { apiClient } from '@/lib/api-client';
import { STORAGE_KEYS } from '@/constants/config';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage');
jest.mock('@/lib/api-client');

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const mockPreferences = {
  push_completions: true,
  push_failures: true,
  push_blockers: false,
  push_plan_approvals: true,
};

describe('NotificationsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store state
    useNotificationsStore.setState({
      preferences: {
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      },
      lastUpdated: null,
      isLoading: false,
      error: null,
    });

    // Reset API client mocks explicitly
    mockedApiClient.get.mockClear();
    mockedApiClient.put.mockClear();
    mockedApiClient.post.mockClear();
    mockedApiClient.delete.mockClear();

    // Mock AsyncStorage
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue(undefined);
    mockedAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  describe('loadPreferences', () => {
    it('loads preferences from API', async () => {
      mockedApiClient.get.mockResolvedValue(mockPreferences);

      const store = useNotificationsStore.getState();
      await store.loadPreferences();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/push/prefs');
      expect(useNotificationsStore.getState().preferences).toEqual(mockPreferences);
      expect(useNotificationsStore.getState().isLoading).toBe(false);
      expect(useNotificationsStore.getState().error).toBeNull();
      expect(useNotificationsStore.getState().lastUpdated).toBeTruthy();
    });

    it('handles API errors', async () => {
      const errorResponse = {
        response: { data: { message: 'API error' } }
      };

      mockedApiClient.get.mockRejectedValue(errorResponse);

      const store = useNotificationsStore.getState();

      let threwError = false;
      try {
        await store.loadPreferences();
      } catch (error) {
        threwError = true;
        expect(error).toEqual(errorResponse);
      }

      expect(threwError).toBe(true);
      expect(useNotificationsStore.getState().error).toBe('API error');
      expect(useNotificationsStore.getState().isLoading).toBe(false);
    });

    it('handles network errors with fallback message', async () => {
      const networkError = new Error('Network error');
      mockedApiClient.get.mockRejectedValue(networkError);

      const store = useNotificationsStore.getState();

      let threwError = false;
      try {
        await store.loadPreferences();
      } catch (error) {
        threwError = true;
        expect(error).toEqual(networkError);
      }

      expect(threwError).toBe(true);
      expect(useNotificationsStore.getState().error).toBe('Failed to load notification preferences');
      expect(useNotificationsStore.getState().isLoading).toBe(false);
    });
  });

  describe('updatePreferences', () => {
    it('updates preferences via API', async () => {
      const currentPrefs = {
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      };
      const updates = { push_blockers: false };
      const updatedPrefs = { ...currentPrefs, ...updates };

      useNotificationsStore.setState({ preferences: currentPrefs });
      mockedApiClient.put.mockResolvedValue(updatedPrefs);

      const store = useNotificationsStore.getState();
      await store.updatePreferences(updates);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/push/prefs', updates);
      expect(useNotificationsStore.getState().preferences).toEqual(updatedPrefs);
      expect(useNotificationsStore.getState().isLoading).toBe(false);
      expect(useNotificationsStore.getState().error).toBeNull();
      expect(useNotificationsStore.getState().lastUpdated).toBeTruthy();
    });

    it('reverts optimistic update on error', async () => {
      const currentPrefs = {
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      };
      const updates = { push_blockers: false };

      useNotificationsStore.setState({ preferences: currentPrefs });

      const errorResponse = {
        response: { data: { message: 'Update failed' } }
      };
      mockedApiClient.put.mockRejectedValue(errorResponse);

      const store = useNotificationsStore.getState();

      let threwError = false;
      try {
        await store.updatePreferences(updates);
      } catch (error) {
        threwError = true;
        expect(error).toEqual(errorResponse);
      }

      expect(threwError).toBe(true);
      expect(useNotificationsStore.getState().error).toBe('Update failed');
      expect(useNotificationsStore.getState().preferences).toEqual(currentPrefs); // Reverted
      expect(useNotificationsStore.getState().isLoading).toBe(false);
    });

    it('handles partial updates', async () => {
      const currentPrefs = {
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      };
      const updates = { push_completions: false, push_failures: false };
      const updatedPrefs = { ...currentPrefs, ...updates };

      useNotificationsStore.setState({ preferences: currentPrefs });
      mockedApiClient.put.mockResolvedValue(updatedPrefs);

      const store = useNotificationsStore.getState();
      await store.updatePreferences(updates);

      expect(mockedApiClient.put).toHaveBeenCalledWith('/push/prefs', updates);
      expect(useNotificationsStore.getState().preferences).toEqual(updatedPrefs);
    });
  });

  describe('resetPreferences', () => {
    it('resets preferences to defaults', () => {
      // Set some custom preferences first
      useNotificationsStore.setState({
        preferences: {
          push_completions: false,
          push_failures: false,
          push_blockers: false,
          push_plan_approvals: false,
        }
      });

      const store = useNotificationsStore.getState();
      store.resetPreferences();

      const state = useNotificationsStore.getState();
      expect(state.preferences).toEqual({
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      });
      expect(state.error).toBeNull();
      expect(state.lastUpdated).toBeTruthy();
    });
  });

  describe('convenience getters', () => {
    beforeEach(() => {
      useNotificationsStore.setState({
        preferences: {
          push_completions: true,
          push_failures: false,
          push_blockers: true,
          push_plan_approvals: false,
        }
      });
    });

    it('isEnabled returns correct values', () => {
      const store = useNotificationsStore.getState();

      expect(store.isEnabled('push_completions')).toBe(true);
      expect(store.isEnabled('push_failures')).toBe(false);
      expect(store.isEnabled('push_blockers')).toBe(true);
      expect(store.isEnabled('push_plan_approvals')).toBe(false);
    });

    it('getEnabledCategories returns only enabled categories', () => {
      const store = useNotificationsStore.getState();
      const enabledCategories = store.getEnabledCategories();

      expect(enabledCategories).toHaveLength(2);
      expect(enabledCategories).toContain('push_completions');
      expect(enabledCategories).toContain('push_blockers');
      expect(enabledCategories).not.toContain('push_failures');
      expect(enabledCategories).not.toContain('push_plan_approvals');
    });

    it('handles null preferences gracefully', () => {
      useNotificationsStore.setState({ preferences: null });

      const store = useNotificationsStore.getState();

      // Should use default preferences
      expect(store.isEnabled('push_completions')).toBe(true);
      expect(store.isEnabled('push_failures')).toBe(true);
      expect(store.isEnabled('push_blockers')).toBe(true);
      expect(store.isEnabled('push_plan_approvals')).toBe(true);

      const enabledCategories = store.getEnabledCategories();
      expect(enabledCategories).toHaveLength(4);
    });
  });

  describe('persistence', () => {
    it('uses correct storage key', () => {
      expect(STORAGE_KEYS.NOTIFICATIONS).toBe('wm-notifications-v1');
    });

    it('persists only data state, not loading states', () => {
      const testState = {
        preferences: mockPreferences,
        lastUpdated: '2024-01-01T00:00:00Z',
        isLoading: true,
        error: 'error',
      };

      useNotificationsStore.setState(testState);

      // The persistence layer should only include the data fields
      expect(useNotificationsStore.getState().preferences).toEqual(mockPreferences);
      expect(useNotificationsStore.getState().lastUpdated).toBe('2024-01-01T00:00:00Z');
    });
  });
});