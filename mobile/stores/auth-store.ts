import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { tokenManager } from '@/lib/api-client';

// Storage keys for biometric attempts
const BIOMETRIC_STORAGE_KEYS = {
  FAILED_ATTEMPTS: 'biometric_failed_attempts',
  LAST_FAILURE_TIME: 'biometric_last_failure_time',
} as const;

// Types
interface User {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: string;
  mfaEnabled: boolean;
}

interface AuthState {
  // Auth state
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;

  // Biometric state
  biometricFailedAttempts: number;
  shouldShowBiometric: boolean;

  // Actions
  signIn: (tokens: { accessToken: string; refreshToken: string; idToken: string }, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  checkAuthState: () => Promise<boolean>;

  // Biometric actions
  recordBiometricFailure: () => Promise<void>;
  resetBiometricAttempts: () => Promise<void>;
  checkBiometricFailures: () => Promise<void>;
  setShouldShowBiometric: (show: boolean) => void;

  // Loading state
  setLoading: (loading: boolean) => void;
}

// Parse user from ID token (JWT payload)
const parseUserFromIdToken = (idToken: string): User | null => {
  try {
    // JWT format: header.payload.signature
    const payload = idToken.split('.')[1];
    if (!payload) return null;

    // Decode base64 payload (React Native compatible)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decodedPayload = JSON.parse(atob(base64));

    return {
      id: decodedPayload.sub || decodedPayload['cognito:username'],
      email: decodedPayload.email,
      name: decodedPayload.name || decodedPayload.given_name || decodedPayload.email,
      organizationId: decodedPayload['custom:org_id'],
      organizationName: decodedPayload['custom:org_name'],
      role: decodedPayload['custom:role'] || 'member',
      mfaEnabled: decodedPayload['custom:mfa_enabled'] === 'true',
    };
  } catch (error) {
    console.warn('Failed to parse user from ID token:', error);
    return null;
  }
};

// Store implementation
export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  isAuthenticated: false,
  isLoading: false,
  user: null,
  biometricFailedAttempts: 0,
  shouldShowBiometric: false,

  // Sign in action
  signIn: async (tokens, user) => {
    try {
      // Store tokens securely
      await tokenManager.setTokens(tokens);

      // Reset biometric failures on successful sign-in
      await get().resetBiometricAttempts();

      // Update store state
      set({
        isAuthenticated: true,
        user,
        shouldShowBiometric: true, // Enable biometric for next launch
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to sign in:', error);
      throw error;
    }
  },

  // Sign out action
  signOut: async () => {
    try {
      // Clear stored tokens
      await tokenManager.clearTokens();

      // Clear biometric settings
      await SecureStore.deleteItemAsync(BIOMETRIC_STORAGE_KEYS.FAILED_ATTEMPTS);
      await SecureStore.deleteItemAsync(BIOMETRIC_STORAGE_KEYS.LAST_FAILURE_TIME);

      // Reset store state
      set({
        isAuthenticated: false,
        user: null,
        biometricFailedAttempts: 0,
        shouldShowBiometric: false,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to sign out:', error);
      // Still reset state even if cleanup fails
      set({
        isAuthenticated: false,
        user: null,
        biometricFailedAttempts: 0,
        shouldShowBiometric: false,
        isLoading: false,
      });
    }
  },

  // Check current auth state from stored tokens
  checkAuthState: async () => {
    try {
      set({ isLoading: true });

      // Check if tokens exist
      const hasTokens = await tokenManager.hasValidTokens();
      if (!hasTokens) {
        set({ isAuthenticated: false, user: null, isLoading: false });
        return false;
      }

      // Try to get user info from stored ID token
      const idToken = await tokenManager.getIdToken();
      if (!idToken) {
        set({ isAuthenticated: false, user: null, isLoading: false });
        return false;
      }

      // Parse user from ID token
      const user = parseUserFromIdToken(idToken);
      if (!user) {
        // If we can't parse user, clear tokens and sign out
        await get().signOut();
        return false;
      }

      // Check biometric failure count
      await get().checkBiometricFailures();

      set({
        isAuthenticated: true,
        user,
        shouldShowBiometric: true, // Show biometric if user has valid tokens
        isLoading: false,
      });

      return true;
    } catch (error) {
      console.error('Failed to check auth state:', error);
      set({ isAuthenticated: false, user: null, isLoading: false });
      return false;
    }
  },

  // Record biometric failure
  recordBiometricFailure: async () => {
    try {
      const currentAttempts = get().biometricFailedAttempts;
      const newAttempts = currentAttempts + 1;

      // Store failure count and timestamp
      await SecureStore.setItemAsync(
        BIOMETRIC_STORAGE_KEYS.FAILED_ATTEMPTS,
        newAttempts.toString()
      );
      await SecureStore.setItemAsync(
        BIOMETRIC_STORAGE_KEYS.LAST_FAILURE_TIME,
        Date.now().toString()
      );

      set({
        biometricFailedAttempts: newAttempts,
        // After 3 failures, disable biometric and require full sign-in
        shouldShowBiometric: newAttempts < 3,
      });
    } catch (error) {
      console.error('Failed to record biometric failure:', error);
    }
  },

  // Reset biometric attempts (called on successful authentication)
  resetBiometricAttempts: async () => {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_STORAGE_KEYS.FAILED_ATTEMPTS);
      await SecureStore.deleteItemAsync(BIOMETRIC_STORAGE_KEYS.LAST_FAILURE_TIME);

      set({
        biometricFailedAttempts: 0,
        shouldShowBiometric: true,
      });
    } catch (error) {
      console.error('Failed to reset biometric attempts:', error);
    }
  },

  // Check biometric failures (persisted across app restarts)
  checkBiometricFailures: async () => {
    try {
      const failedAttemptsStr = await SecureStore.getItemAsync(BIOMETRIC_STORAGE_KEYS.FAILED_ATTEMPTS);
      const failedAttempts = failedAttemptsStr ? parseInt(failedAttemptsStr, 10) : 0;

      set({
        biometricFailedAttempts: failedAttempts,
        // If 3 or more failures, require full sign-in
        shouldShowBiometric: failedAttempts < 3,
      });
    } catch (error) {
      console.error('Failed to check biometric failures:', error);
      // On error, allow biometric attempts
      set({
        biometricFailedAttempts: 0,
        shouldShowBiometric: true,
      });
    }
  },

  // Set biometric preference
  setShouldShowBiometric: (show: boolean) => {
    set({ shouldShowBiometric: show });
  },

  // Set loading state
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },
}));