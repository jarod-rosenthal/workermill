import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@/lib/api-client';

// Secure store keys
const SECURE_STORE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  ID_TOKEN: 'id_token',
  BIOMETRIC_FAIL_COUNT: 'biometric_fail_count',
  BIOMETRIC_ENABLED: 'biometric_enabled',
} as const;

export interface UserOrganization {
  id: string;
  name: string;
  plan: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  organization: UserOrganization | null;
}

interface AuthState {
  // Authentication state
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: string | null;

  // Biometric settings
  isBiometricEnabled: boolean;
  biometricFailCount: number;
  shouldShowBiometric: boolean;

  // Actions
  setAuthenticated: (user: User) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Token management
  storeTokens: (tokens: {
    accessToken: string;
    refreshToken: string;
    idToken: string;
  }) => Promise<void>;
  clearTokens: () => Promise<void>;
  hasStoredTokens: () => Promise<boolean>;

  // Biometric management
  enableBiometric: () => Promise<void>;
  disableBiometric: () => Promise<void>;
  incrementBiometricFailCount: () => Promise<void>;
  resetBiometricFailCount: () => Promise<void>;
  loadBiometricSettings: () => Promise<void>;

  // Auth operations
  signIn: (email: string, password: string) => Promise<void>;
  signInWithSSO: (tokens: {
    accessToken: string;
    refreshToken: string;
    idToken: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  isAuthenticated: false,
  user: null,
  isLoading: false,
  error: null,
  isBiometricEnabled: false,
  biometricFailCount: 0,
  shouldShowBiometric: false,

  // Basic setters
  setAuthenticated: (user: User) => set({
    isAuthenticated: true,
    user,
    error: null
  }),

  setLoading: (isLoading: boolean) => set({ isLoading }),

  setError: (error: string | null) => set({ error }),

  // Token management
  storeTokens: async (tokens) => {
    await apiClient.storeTokens(tokens);
  },

  clearTokens: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_STORE_KEYS.ACCESS_TOKEN).catch(() => {}),
      SecureStore.deleteItemAsync(SECURE_STORE_KEYS.REFRESH_TOKEN).catch(() => {}),
      SecureStore.deleteItemAsync(SECURE_STORE_KEYS.ID_TOKEN).catch(() => {}),
    ]);
  },

  hasStoredTokens: async (): Promise<boolean> => {
    try {
      const tokens = await apiClient.getStoredTokens();
      return !!(tokens.accessToken && tokens.refreshToken);
    } catch {
      return false;
    }
  },

  // Biometric management
  enableBiometric: async () => {
    await SecureStore.setItemAsync(SECURE_STORE_KEYS.BIOMETRIC_ENABLED, 'true');
    set({ isBiometricEnabled: true });
  },

  disableBiometric: async () => {
    await SecureStore.setItemAsync(SECURE_STORE_KEYS.BIOMETRIC_ENABLED, 'false');
    set({ isBiometricEnabled: false });
  },

  incrementBiometricFailCount: async () => {
    const currentCount = get().biometricFailCount;
    const newCount = currentCount + 1;

    await SecureStore.setItemAsync(SECURE_STORE_KEYS.BIOMETRIC_FAIL_COUNT, newCount.toString());
    set({
      biometricFailCount: newCount,
      shouldShowBiometric: newCount < 3
    });
  },

  resetBiometricFailCount: async () => {
    await SecureStore.setItemAsync(SECURE_STORE_KEYS.BIOMETRIC_FAIL_COUNT, '0');
    set({
      biometricFailCount: 0,
      shouldShowBiometric: get().isBiometricEnabled,
    });
  },

  loadBiometricSettings: async () => {
    try {
      const [enabledStr, countStr] = await Promise.all([
        SecureStore.getItemAsync(SECURE_STORE_KEYS.BIOMETRIC_ENABLED),
        SecureStore.getItemAsync(SECURE_STORE_KEYS.BIOMETRIC_FAIL_COUNT),
      ]);

      const isBiometricEnabled = enabledStr === 'true';
      const biometricFailCount = countStr ? parseInt(countStr, 10) : 0;
      const shouldShowBiometric = isBiometricEnabled && biometricFailCount < 3;

      set({
        isBiometricEnabled,
        biometricFailCount,
        shouldShowBiometric,
      });
    } catch (error) {
      console.error('Failed to load biometric settings:', error);
      set({
        isBiometricEnabled: false,
        biometricFailCount: 0,
        shouldShowBiometric: false,
      });
    }
  },

  // Auth operations
  signIn: async (email: string, password: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await apiClient.post<{
        tokens: {
          accessToken: string;
          refreshToken: string;
          idToken: string;
        };
      }>('/auth/login', { email, password });

      // Store tokens
      await get().storeTokens(response.tokens);

      // Reset biometric fail count on successful sign-in
      await get().resetBiometricFailCount();

      // Fetch user profile now that we have tokens
      await get().refreshUserProfile();
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Sign in failed';
      set({
        isLoading: false,
        error: errorMessage,
        isAuthenticated: false,
        user: null
      });
      throw error;
    }
  },

  signInWithSSO: async (tokens) => {
    set({ isLoading: true, error: null });

    try {
      // Store tokens
      await get().storeTokens(tokens);

      // Reset biometric fail count on successful sign-in
      await get().resetBiometricFailCount();

      // Fetch user profile now that we have tokens
      await get().refreshUserProfile();
    } catch (error: any) {
      const errorMessage = error.message || 'SSO sign in failed';
      set({
        isLoading: false,
        error: errorMessage,
        isAuthenticated: false,
        user: null
      });
      throw error;
    }
  },

  signOut: async () => {
    set({ isLoading: true });

    try {
      // Clear tokens from secure store
      await get().clearTokens();
      await apiClient.signOut();

      // Reset all auth state
      set({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null,
        // Keep biometric settings but reset fail count
        biometricFailCount: 0,
        shouldShowBiometric: get().isBiometricEnabled,
      });
    } catch (error) {
      console.error('Sign out error:', error);
      // Force reset state even if sign out fails
      set({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null,
        biometricFailCount: 0,
        shouldShowBiometric: get().isBiometricEnabled,
      });
    }
  },

  checkAuthStatus: async () => {
    set({ isLoading: true });

    try {
      const hasTokens = await get().hasStoredTokens();

      if (hasTokens) {
        // Try to fetch user profile to validate tokens
        await get().refreshUserProfile();
      } else {
        set({
          isAuthenticated: false,
          user: null,
          isLoading: false
        });
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      // Clear invalid tokens
      await get().clearTokens();
      set({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null
      });
    }
  },

  refreshUserProfile: async () => {
    try {
      const response = await apiClient.get<{
        user: { id: string; email: string; fullName: string; role: string };
        organization: UserOrganization | null;
      }>('/auth/me');
      const user: User = {
        id: response.user.id,
        email: response.user.email,
        name: response.user.fullName,
        role: (response.user.role as 'admin' | 'member') || 'member',
        organization: response.organization,
      };
      set({
        isAuthenticated: true,
        user,
        isLoading: false,
        error: null
      });
    } catch (error: any) {
      // If user profile fetch fails, tokens might be invalid
      console.error('User profile refresh failed:', error);
      await get().clearTokens();
      set({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: 'Session expired'
      });
      throw error;
    }
  },
}));