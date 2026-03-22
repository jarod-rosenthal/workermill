import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, COGNITO_REGION, COGNITO_CLIENT_ID } from '@/constants/config';

// Secure store keys for tokens
const TOKEN_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  ID_TOKEN: 'id_token',
} as const;

interface CognitoRefreshResponse {
  AuthenticationResult: {
    AccessToken: string;
    IdToken: string;
    ExpiresIn: number;
    TokenType: string;
  };
}

class ApiClient {
  private axiosInstance: AxiosInstance;
  private isRefreshing = false;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor - add auth header
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const accessToken = await SecureStore.getItemAsync(TOKEN_KEYS.ACCESS_TOKEN);
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle 401 with token refresh
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && originalRequest) {
          if (originalRequest._retry) {
            // Retried request still got 401 — session is invalid, force sign-out
            await this.clearTokens();
            return Promise.reject(new Error('Session expired — please sign in again'));
          }

          originalRequest._retry = true;

          try {
            const newAccessToken = await this.refreshToken();
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return this.axiosInstance(originalRequest);
          } catch (refreshError) {
            // Refresh failed, clear tokens and redirect to sign-in
            await this.clearTokens();
            throw refreshError;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async refreshToken(): Promise<string> {
    // If already refreshing, return the existing promise
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;

    this.refreshPromise = (async () => {
      try {
        const refreshToken = await SecureStore.getItemAsync(TOKEN_KEYS.REFRESH_TOKEN);
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        let response: Response;
        try {
          response = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
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
            signal: controller.signal,
          });
        } catch (fetchError: any) {
          if (fetchError.name === 'AbortError') {
            throw new Error('Token refresh timed out — please check your connection');
          }
          throw fetchError;
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const cognitoError = errorBody.__type || '';
          if (cognitoError === 'NotAuthorizedException') {
            throw new Error('Session expired — please sign in again');
          }
          throw new Error(`Token refresh failed: ${errorBody.message || response.status}`);
        }

        const data: CognitoRefreshResponse = await response.json();
        const { AccessToken, IdToken } = data.AuthenticationResult;

        // Store new tokens (refresh token is NOT returned, keep existing one)
        await SecureStore.setItemAsync(TOKEN_KEYS.ACCESS_TOKEN, AccessToken);
        await SecureStore.setItemAsync(TOKEN_KEYS.ID_TOKEN, IdToken);

        return AccessToken;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async clearTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEYS.ACCESS_TOKEN).catch(() => {}),
      SecureStore.deleteItemAsync(TOKEN_KEYS.REFRESH_TOKEN).catch(() => {}),
      SecureStore.deleteItemAsync(TOKEN_KEYS.ID_TOKEN).catch(() => {}),
    ]);
  }

  // Public methods
  async storeTokens(tokens: {
    accessToken: string;
    refreshToken: string;
    idToken: string;
  }): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEYS.ACCESS_TOKEN, tokens.accessToken),
      SecureStore.setItemAsync(TOKEN_KEYS.REFRESH_TOKEN, tokens.refreshToken),
      SecureStore.setItemAsync(TOKEN_KEYS.ID_TOKEN, tokens.idToken),
    ]);
  }

  async getStoredTokens(): Promise<{
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
  }> {
    const [accessToken, refreshToken, idToken] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEYS.ACCESS_TOKEN),
      SecureStore.getItemAsync(TOKEN_KEYS.REFRESH_TOKEN),
      SecureStore.getItemAsync(TOKEN_KEYS.ID_TOKEN),
    ]);

    return { accessToken, refreshToken, idToken };
  }

  async signOut(): Promise<void> {
    await this.clearTokens();
  }

  // Expose the axios instance for making requests
  get instance(): AxiosInstance {
    return this.axiosInstance;
  }

  // Common HTTP methods
  async get<T>(url: string, config?: any): Promise<T> {
    const response = await this.axiosInstance.get(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.post(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.put(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: any): Promise<T> {
    const response = await this.axiosInstance.delete(url, config);
    return response.data;
  }
}

// Create a singleton instance
export const apiClient = new ApiClient();
export default apiClient;

// Add the _retry property to the AxiosRequestConfig type
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}