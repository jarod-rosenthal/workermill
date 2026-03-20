import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../auth-store';
import { tokenManager } from '@/lib/api-client';

// Mock dependencies
jest.mock('expo-secure-store');
jest.mock('@/lib/api-client', () => ({
  tokenManager: {
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    hasValidTokens: jest.fn(),
    getIdToken: jest.fn(),
  },
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockedTokenManager = tokenManager as jest.Mocked<typeof tokenManager>;

// Mock atob for JWT parsing
global.atob = jest.fn((base64: string) =>
  JSON.stringify({
    sub: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    'custom:org_id': 'org-456',
    'custom:org_name': 'Test Organization',
    'custom:role': 'admin',
    'custom:mfa_enabled': 'true',
  })
);

describe('Auth Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset zustand store state
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      biometricFailedAttempts: 0,
      shouldShowBiometric: false,
    });
  });

  describe('signIn', () => {
    it('should store tokens and update auth state', async () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      };

      const user = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        organizationId: 'org-456',
        organizationName: 'Test Organization',
        role: 'admin',
        mfaEnabled: true,
      };

      mockedTokenManager.setTokens.mockResolvedValue();
      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      const store = useAuthStore.getState();
      await store.signIn(tokens, user);

      expect(mockedTokenManager.setTokens).toHaveBeenCalledWith(tokens);
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('biometric_failed_attempts');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('biometric_last_failure_time');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(user);
      expect(state.shouldShowBiometric).toBe(true);
      expect(state.biometricFailedAttempts).toBe(0);
    });

    it('should throw error if token storage fails', async () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      };

      const user = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        organizationId: 'org-456',
        organizationName: 'Test Organization',
        role: 'admin',
        mfaEnabled: true,
      };

      const error = new Error('Storage failed');
      mockedTokenManager.setTokens.mockRejectedValue(error);

      const store = useAuthStore.getState();
      await expect(store.signIn(tokens, user)).rejects.toThrow('Storage failed');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('signOut', () => {
    it('should clear tokens and reset auth state', async () => {
      // Set initial authenticated state
      useAuthStore.setState({
        isAuthenticated: true,
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          organizationId: 'org-456',
          organizationName: 'Test Organization',
          role: 'admin',
          mfaEnabled: true,
        },
      });

      mockedTokenManager.clearTokens.mockResolvedValue();
      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      const store = useAuthStore.getState();
      await store.signOut();

      expect(mockedTokenManager.clearTokens).toHaveBeenCalled();
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('biometric_failed_attempts');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('biometric_last_failure_time');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.shouldShowBiometric).toBe(false);
      expect(state.biometricFailedAttempts).toBe(0);
    });

    it('should reset state even if token clearing fails', async () => {
      // Set initial authenticated state
      useAuthStore.setState({ isAuthenticated: true });

      mockedTokenManager.clearTokens.mockRejectedValue(new Error('Clear failed'));

      const store = useAuthStore.getState();
      await store.signOut();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });
  });

  describe('checkAuthState', () => {
    it('should return false when no tokens exist', async () => {
      mockedTokenManager.hasValidTokens.mockResolvedValue(false);

      const store = useAuthStore.getState();
      const result = await store.checkAuthState();

      expect(result).toBe(false);
      expect(mockedTokenManager.hasValidTokens).toHaveBeenCalled();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('should return false when ID token is missing', async () => {
      mockedTokenManager.hasValidTokens.mockResolvedValue(true);
      mockedTokenManager.getIdToken.mockResolvedValue(null);

      const store = useAuthStore.getState();
      const result = await store.checkAuthState();

      expect(result).toBe(false);
      expect(mockedTokenManager.getIdToken).toHaveBeenCalled();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should authenticate user with valid tokens and ID token', async () => {
      const idToken = 'header.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature'; // Mock JWT

      mockedTokenManager.hasValidTokens.mockResolvedValue(true);
      mockedTokenManager.getIdToken.mockResolvedValue(idToken);
      mockedSecureStore.getItemAsync.mockResolvedValue(null); // No biometric failures

      const store = useAuthStore.getState();
      const result = await store.checkAuthState();

      expect(result).toBe(true);

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        organizationId: 'org-456',
        organizationName: 'Test Organization',
        role: 'admin',
        mfaEnabled: true,
      });
      expect(state.shouldShowBiometric).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('should sign out if ID token cannot be parsed', async () => {
      const invalidIdToken = 'invalid-token';

      mockedTokenManager.hasValidTokens.mockResolvedValue(true);
      mockedTokenManager.getIdToken.mockResolvedValue(invalidIdToken);
      mockedTokenManager.clearTokens.mockResolvedValue();
      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      // Mock atob to throw error
      (global.atob as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });

      const store = useAuthStore.getState();
      const result = await store.checkAuthState();

      expect(result).toBe(false);
      expect(mockedTokenManager.clearTokens).toHaveBeenCalled();
    });
  });

  describe('biometric failure tracking', () => {
    it('should record biometric failure and increment counter', async () => {
      mockedSecureStore.setItemAsync.mockResolvedValue();

      const store = useAuthStore.getState();
      await store.recordBiometricFailure();

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'biometric_failed_attempts',
        '1'
      );
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'biometric_last_failure_time',
        expect.any(String)
      );

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(1);
      expect(state.shouldShowBiometric).toBe(true); // Still < 3
    });

    it('should disable biometric after 3 failures', async () => {
      // Set initial failure count to 2
      useAuthStore.setState({ biometricFailedAttempts: 2 });

      mockedSecureStore.setItemAsync.mockResolvedValue();

      const store = useAuthStore.getState();
      await store.recordBiometricFailure();

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(3);
      expect(state.shouldShowBiometric).toBe(false); // Disabled after 3 failures
    });

    it('should reset biometric attempts', async () => {
      // Set initial failure state
      useAuthStore.setState({
        biometricFailedAttempts: 3,
        shouldShowBiometric: false,
      });

      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      const store = useAuthStore.getState();
      await store.resetBiometricAttempts();

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('biometric_failed_attempts');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('biometric_last_failure_time');

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(0);
      expect(state.shouldShowBiometric).toBe(true);
    });

    it('should load biometric failure count on app start', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue('2'); // 2 previous failures

      const store = useAuthStore.getState();
      await store.checkBiometricFailures();

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(2);
      expect(state.shouldShowBiometric).toBe(true); // Still < 3

      expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('biometric_failed_attempts');
    });

    it('should disable biometric if stored failure count is >= 3', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue('3'); // 3 previous failures

      const store = useAuthStore.getState();
      await store.checkBiometricFailures();

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(3);
      expect(state.shouldShowBiometric).toBe(false); // Disabled
    });

    it('should default to 0 failures if no stored data', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      const store = useAuthStore.getState();
      await store.checkBiometricFailures();

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(0);
      expect(state.shouldShowBiometric).toBe(true);
    });

    it('should handle storage errors gracefully', async () => {
      mockedSecureStore.getItemAsync.mockRejectedValue(new Error('Storage error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const store = useAuthStore.getState();
      await store.checkBiometricFailures();

      // Should default to allowing biometric on error
      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(0);
      expect(state.shouldShowBiometric).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('biometric failure persistence across app restarts', () => {
    it('should persist failure count across app restarts', async () => {
      // Simulate first app session - record 2 failures
      mockedSecureStore.setItemAsync.mockResolvedValue();

      const store1 = useAuthStore.getState();
      await store1.recordBiometricFailure();
      await store1.recordBiometricFailure();

      // Reset store to simulate app restart
      useAuthStore.setState({
        biometricFailedAttempts: 0,
        shouldShowBiometric: false,
      });

      // Simulate app restart - check failures
      mockedSecureStore.getItemAsync.mockResolvedValue('2');

      const store2 = useAuthStore.getState();
      await store2.checkBiometricFailures();

      const state = useAuthStore.getState();
      expect(state.biometricFailedAttempts).toBe(2);
      expect(state.shouldShowBiometric).toBe(true); // Still < 3

      // Add one more failure to reach limit
      await store2.recordBiometricFailure();

      const finalState = useAuthStore.getState();
      expect(finalState.biometricFailedAttempts).toBe(3);
      expect(finalState.shouldShowBiometric).toBe(false); // Now disabled
    });
  });

  describe('loading state', () => {
    it('should set loading state', () => {
      const store = useAuthStore.getState();
      store.setLoading(true);

      let state = useAuthStore.getState();
      expect(state.isLoading).toBe(true);

      store.setLoading(false);

      state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
    });

    it('should set loading during checkAuthState', async () => {
      mockedTokenManager.hasValidTokens.mockResolvedValue(false);

      const store = useAuthStore.getState();
      const checkPromise = store.checkAuthState();

      // Should be loading during async check
      let state = useAuthStore.getState();
      expect(state.isLoading).toBe(true);

      await checkPromise;

      // Should not be loading after check completes
      state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
    });
  });
});