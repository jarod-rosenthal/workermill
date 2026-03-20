import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { API_BASE_URL, COGNITO_REGION, COGNITO_CLIENT_ID } from '@/constants/config';

// Keys for secure storage
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  ID_TOKEN: 'id_token',
} as const;

// Create axios instance with base configuration
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Flag to prevent multiple concurrent refresh attempts
let isRefreshingToken = false;
let failedRequestsQueue: {
  resolve: (token: string) => void;
  reject: (error: any) => void;
}[] = [];

// Request interceptor to add auth header
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const accessToken = await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
      }
    } catch (error) {
      console.warn('Failed to read access token from secure store:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 errors and refresh tokens
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshingToken) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedRequestsQueue.push({
            resolve: (token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(apiClient(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshingToken = true;

      try {
        const refreshToken = await SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN);

        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        // Call Cognito refresh endpoint
        const refreshResponse = await fetch(
          `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-amz-json-1.1',
              'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
            },
            body: JSON.stringify({
              AuthFlow: 'REFRESH_TOKEN_AUTH',
              ClientId: COGNITO_CLIENT_ID,
              AuthParameters: {
                REFRESH_TOKEN: refreshToken,
              },
            }),
          }
        );

        if (!refreshResponse.ok) {
          throw new Error(`Token refresh failed: ${refreshResponse.status}`);
        }

        const refreshData = await refreshResponse.json();

        if (!refreshData.AuthenticationResult) {
          throw new Error('Invalid refresh response format');
        }

        const { AccessToken, IdToken } = refreshData.AuthenticationResult;

        // Store new tokens (RefreshToken is not returned on refresh - keep the existing one)
        await SecureStore.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, AccessToken);
        await SecureStore.setItemAsync(STORAGE_KEYS.ID_TOKEN, IdToken);

        // Process queued requests
        failedRequestsQueue.forEach(({ resolve }) => {
          resolve(AccessToken);
        });
        failedRequestsQueue = [];

        // Retry the original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${AccessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Clear stored tokens and redirect to sign-in
        await Promise.all([
          SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
          SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
          SecureStore.deleteItemAsync(STORAGE_KEYS.ID_TOKEN),
        ]);

        // Process queued requests with error
        failedRequestsQueue.forEach(({ reject }) => {
          reject(refreshError);
        });
        failedRequestsQueue = [];

        // Navigate to sign-in screen
        router.replace('/(auth)/sign-in');

        return Promise.reject(refreshError);
      } finally {
        isRefreshingToken = false;
      }
    }

    return Promise.reject(error);
  }
);

// Helper functions for token management
export const tokenManager = {
  async getAccessToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
    } catch (error) {
      console.warn('Failed to read access token:', error);
      return null;
    }
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
    } catch (error) {
      console.warn('Failed to read refresh token:', error);
      return null;
    }
  },

  async getIdToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.ID_TOKEN);
    } catch (error) {
      console.warn('Failed to read ID token:', error);
      return null;
    }
  },

  async setTokens(tokens: {
    accessToken: string;
    refreshToken: string;
    idToken: string;
  }): Promise<void> {
    try {
      await Promise.all([
        SecureStore.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken),
        SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken),
        SecureStore.setItemAsync(STORAGE_KEYS.ID_TOKEN, tokens.idToken),
      ]);
    } catch (error) {
      console.error('Failed to store tokens:', error);
      throw error;
    }
  },

  async clearTokens(): Promise<void> {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
        SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
        SecureStore.deleteItemAsync(STORAGE_KEYS.ID_TOKEN),
      ]);
    } catch (error) {
      console.warn('Failed to clear tokens:', error);
    }
  },

  async hasValidTokens(): Promise<boolean> {
    try {
      const accessToken = await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
      const refreshToken = await SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
      return !!(accessToken && refreshToken);
    } catch (error) {
      console.warn('Failed to check token validity:', error);
      return false;
    }
  },
};

export default apiClient;