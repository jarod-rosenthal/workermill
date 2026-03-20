import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../auth-store';
import { apiClient } from '@/lib/api-client';

// Mock dependencies
jest.mock('expo-secure-store');
jest.mock('@/lib/api-client');

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Setup default mock implementations
beforeAll(() => {
  // Mock SecureStore methods to return promises
  mockedSecureStore.setItemAsync.mockImplementation(() => Promise.resolve());
  mockedSecureStore.deleteItemAsync.mockImplementation(() => Promise.resolve());
  mockedSecureStore.getItemAsync.mockImplementation(() => Promise.resolve(null));

  // Mock API client methods to return promises
  mockedApiClient.storeTokens.mockImplementation(() => Promise.resolve());
  mockedApiClient.signOut.mockImplementation(() => Promise.resolve());
  mockedApiClient.get.mockImplementation(() => Promise.resolve({}));
  mockedApiClient.post.mockImplementation(() => Promise.resolve({}));
  mockedApiClient.getStoredTokens.mockImplementation(() => Promise.resolve({
    accessToken: null,
    refreshToken: null,
    idToken: null,
  }));
});

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'member' as const,
  organizations: [
    {
      id: 'org-1',
      name: 'Test Org',
      role: 'member',
    },
  ],
  current_organization: {
    id: 'org-1',
    name: 'Test Org',
    plan: 'pro',
  },
};

const mockTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  idToken: 'id-token',
};

describe('AuthStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the store state
    useAuthStore.setState({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: null,
      isBiometricEnabled: false,
      biometricFailCount: 0,
      shouldShowBiometric: false,
    });
  });

  describe('Token Management', () => {
    it('should store tokens correctly', async () => {
      const store = useAuthStore.getState();

      await store.storeTokens(mockTokens);

      expect(mockedApiClient.storeTokens).toHaveBeenCalledWith(mockTokens);
    });

    it('should clear tokens correctly', async () => {
      const store = useAuthStore.getState();

      await store.clearTokens();

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('id_token');
    });

    it('should check for stored tokens correctly', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.getStoredTokens.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      });

      const hasTokens = await store.hasStoredTokens();

      expect(hasTokens).toBe(true);
    });

    it('should return false for hasStoredTokens when tokens are missing', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.getStoredTokens.mockResolvedValue({
        accessToken: null,
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      });

      const hasTokens = await store.hasStoredTokens();

      expect(hasTokens).toBe(false);
    });
  });

  describe('Biometric Management', () => {
    it('should enable biometric authentication', async () => {
      const store = useAuthStore.getState();

      await store.enableBiometric();

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('biometric_enabled', 'true');
      expect(useAuthStore.getState().isBiometricEnabled).toBe(true);
    });

    it('should disable biometric authentication', async () => {
      const store = useAuthStore.getState();

      await store.disableBiometric();

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('biometric_enabled', 'false');
      expect(useAuthStore.getState().isBiometricEnabled).toBe(false);
    });

    it('should increment biometric fail count and update shouldShowBiometric', async () => {
      const store = useAuthStore.getState();

      // Set initial state
      useAuthStore.setState({ biometricFailCount: 1 });

      await store.incrementBiometricFailCount();

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('biometric_fail_count', '2');
      expect(useAuthStore.getState().biometricFailCount).toBe(2);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(true);
    });

    it('should disable biometric after 3 failed attempts', async () => {
      const store = useAuthStore.getState();

      // Set initial state to 2 failures
      useAuthStore.setState({ biometricFailCount: 2 });

      await store.incrementBiometricFailCount();

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('biometric_fail_count', '3');
      expect(useAuthStore.getState().biometricFailCount).toBe(3);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(false);
    });

    it('should reset biometric fail count', async () => {
      const store = useAuthStore.getState();

      await store.resetBiometricFailCount();

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('biometric_fail_count', '0');
      expect(useAuthStore.getState().biometricFailCount).toBe(0);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(true);
    });

    it('should load biometric settings correctly', async () => {
      const store = useAuthStore.getState();

      mockedSecureStore.getItemAsync.mockImplementation((key) => {
        if (key === 'biometric_enabled') return Promise.resolve('true');
        if (key === 'biometric_fail_count') return Promise.resolve('2');
        return Promise.resolve(null);
      });

      await store.loadBiometricSettings();

      expect(useAuthStore.getState().isBiometricEnabled).toBe(true);
      expect(useAuthStore.getState().biometricFailCount).toBe(2);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(true);
    });

    it('should handle missing biometric settings gracefully', async () => {
      const store = useAuthStore.getState();

      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      await store.loadBiometricSettings();

      expect(useAuthStore.getState().isBiometricEnabled).toBe(false);
      expect(useAuthStore.getState().biometricFailCount).toBe(0);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(false);
    });

    it('should persist biometric fail count across app restarts', async () => {
      const store = useAuthStore.getState();

      // Simulate app restart by loading settings with existing fail count
      mockedSecureStore.getItemAsync.mockImplementation((key) => {
        if (key === 'biometric_enabled') return Promise.resolve('true');
        if (key === 'biometric_fail_count') return Promise.resolve('3');
        return Promise.resolve(null);
      });

      await store.loadBiometricSettings();

      // Should still be disabled from previous failures
      expect(useAuthStore.getState().biometricFailCount).toBe(3);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(false);
    });
  });

  describe('Authentication Operations', () => {
    it('should sign in with email and password successfully', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.post.mockResolvedValue({
        user: mockUser,
        tokens: mockTokens,
      });

      await store.signIn('test@example.com', 'password');

      expect(mockedApiClient.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password',
      });
      expect(mockedApiClient.storeTokens).toHaveBeenCalledWith(mockTokens);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().biometricFailCount).toBe(0);
    });

    it('should handle sign in failure', async () => {
      const store = useAuthStore.getState();

      const error = {
        response: { data: { message: 'Invalid credentials' } },
      };
      mockedApiClient.post.mockRejectedValue(error);

      let threwError = false;
      try {
        await store.signIn('test@example.com', 'wrong-password');
      } catch (err) {
        threwError = true;
        expect(err).toEqual(error);
      }

      expect(threwError).toBe(true);

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBe(null);
      expect(useAuthStore.getState().error).toBe('Invalid credentials');
    });

    it('should sign in with SSO successfully', async () => {
      const store = useAuthStore.getState();

      await store.signInWithSSO(mockTokens, mockUser);

      expect(mockedApiClient.storeTokens).toHaveBeenCalledWith(mockTokens);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().biometricFailCount).toBe(0);
    });

    it('should sign out successfully', async () => {
      const store = useAuthStore.getState();

      // Set initial authenticated state
      useAuthStore.setState({
        isAuthenticated: true,
        user: mockUser,
        biometricFailCount: 2,
        isBiometricEnabled: true,
      });

      await store.signOut();

      expect(mockedApiClient.signOut).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBe(null);
      expect(useAuthStore.getState().biometricFailCount).toBe(0);
      expect(useAuthStore.getState().shouldShowBiometric).toBe(true); // Should preserve biometric enabled state
    });

    it('should check auth status with valid tokens', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.getStoredTokens.mockResolvedValue({
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh',
        idToken: 'valid-id',
      });
      mockedApiClient.get.mockResolvedValue(mockUser);

      await store.checkAuthStatus();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('should clear auth state when no tokens exist', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.getStoredTokens.mockResolvedValue({
        accessToken: null,
        refreshToken: null,
        idToken: null,
      });

      await store.checkAuthStatus();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBe(null);
    });

    it('should refresh user profile successfully', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.get.mockResolvedValue(mockUser);

      await store.refreshUserProfile();

      expect(mockedApiClient.get).toHaveBeenCalledWith('/auth/me');
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('should handle user profile refresh failure', async () => {
      const store = useAuthStore.getState();

      mockedApiClient.get.mockRejectedValue(new Error('Unauthorized'));

      await expect(store.refreshUserProfile()).rejects.toThrow();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBe(null);
      expect(useAuthStore.getState().error).toBe('Session expired');
    });
  });

  describe('State Setters', () => {
    it('should set authenticated state correctly', () => {
      const store = useAuthStore.getState();

      store.setAuthenticated(mockUser);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().error).toBe(null);
    });

    it('should set loading state correctly', () => {
      const store = useAuthStore.getState();

      store.setLoading(true);

      expect(useAuthStore.getState().isLoading).toBe(true);
    });

    it('should set error state correctly', () => {
      const store = useAuthStore.getState();

      store.setError('Test error');

      expect(useAuthStore.getState().error).toBe('Test error');
    });
  });
});