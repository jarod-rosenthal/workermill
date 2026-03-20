import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { COGNITO_REGION, COGNITO_CLIENT_ID } from '@/constants/config';

// Mock dependencies
jest.mock('expo-secure-store');

// Mock axios with proper instance structure
const mockAxiosInstance = jest.fn() as any;
Object.assign(mockAxiosInstance, {
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  request: jest.fn(),
});

jest.mock('axios', () => {
  const mockAxios = {
    create: jest.fn(() => mockAxiosInstance),
  };
  // Mock both default and named exports
  return {
    __esModule: true,
    default: mockAxios,
    ...mockAxios,
  };
});

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

// Mock fetch globally
global.fetch = jest.fn();

// Store references to interceptor functions before they get cleared by jest.clearAllMocks
let requestInterceptor: any;
let responseInterceptor: any;

// Import apiClient after mocks are set up
import { apiClient } from '../api-client';

// Capture the interceptor functions after the api client is constructed
requestInterceptor = mockAxiosInstance.interceptors.request.use.mock.calls[0][0];
responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];

describe('ApiClient', () => {
  beforeEach(() => {
    // Clear only specific mocks, not the interceptor registration calls
    mockedSecureStore.deleteItemAsync.mockClear();
    mockedSecureStore.setItemAsync.mockClear();
    mockedSecureStore.getItemAsync.mockClear();
    global.fetch = jest.fn();

    // Ensure SecureStore methods return promises
    mockedSecureStore.deleteItemAsync.mockImplementation(() => Promise.resolve());
    mockedSecureStore.setItemAsync.mockImplementation(() => Promise.resolve());
    mockedSecureStore.getItemAsync.mockImplementation(() => Promise.resolve(null));
  });

  describe('Request Interceptor', () => {
    it('should add Authorization header when access token exists', async () => {
      const accessToken = 'test-access-token';
      mockedSecureStore.getItemAsync.mockResolvedValue(accessToken);

      const config = {
        headers: {} as any,
      };

      await requestInterceptor(config);

      expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('access_token');
      expect(config.headers.Authorization).toBe(`Bearer ${accessToken}`);
    });

    it('should not add Authorization header when access token does not exist', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      const config = {
        headers: {} as any,
      };

      await requestInterceptor(config);

      expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('access_token');
      expect(config.headers.Authorization).toBeUndefined();
    });
  });

  describe('Response Interceptor - 401 Handling', () => {
    let mockAxiosCall: jest.Mock;

    beforeEach(() => {
      mockAxiosCall = jest.fn();
    });

    it('should trigger Cognito refresh on 401 with correct request shape', async () => {
      const refreshToken = 'test-refresh-token';
      const newAccessToken = 'new-access-token';
      const newIdToken = 'new-id-token';

      // Mock the 401 error
      const error = {
        response: { status: 401 },
        config: {
          headers: {} as any,
          _retry: undefined,
        },
      };

      // Mock SecureStore calls
      mockedSecureStore.getItemAsync.mockImplementation((key) => {
        if (key === 'refresh_token') return Promise.resolve(refreshToken);
        return Promise.resolve(null);
      });

      // Mock successful Cognito refresh response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          AuthenticationResult: {
            AccessToken: newAccessToken,
            IdToken: newIdToken,
            ExpiresIn: 3600,
            TokenType: 'Bearer',
          },
        }),
      });

      // Mock successful retry request (the interceptor calls this.axiosInstance(originalRequest))
      mockAxiosInstance.mockResolvedValueOnce({ data: 'success' });

      await responseInterceptor(error);

      // Verify Cognito API call with correct request shape
      expect(global.fetch).toHaveBeenCalledWith(
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

      // Verify new tokens are stored
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('access_token', newAccessToken);
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('id_token', newIdToken);

      // Verify refresh token is NOT overwritten (not called with refresh_token key)
      expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalledWith('refresh_token', expect.anything());

      // Verify retry request has new auth header
      expect(error.config.headers.Authorization).toBe(`Bearer ${newAccessToken}`);
      expect(error.config._retry).toBe(true);
    });

    it('should clear store and navigate to sign-in on refresh failure', async () => {
      const error = {
        response: { status: 401 },
        config: {
          headers: {} as any,
          _retry: undefined,
        },
      };

      mockedSecureStore.getItemAsync.mockResolvedValue(null); // No refresh token

      try {
        await responseInterceptor(error);
      } catch {
        // Should clear all tokens on refresh failure
        expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
        expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
        expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('id_token');
      }
    });

    it('should not retry request that has already been retried', async () => {
      const error = {
        response: { status: 401 },
        config: {
          headers: {} as any,
          _retry: true, // Already retried
        },
      };

      try {
        await responseInterceptor(error);
      } catch (e) {
        // Should reject immediately without attempting refresh
        expect(global.fetch).not.toHaveBeenCalled();
        expect(e).toBe(error);
      }
    });

    it('should pass through non-401 errors', async () => {
      const error = {
        response: { status: 500 },
        config: {
          headers: {} as any,
        },
      };

      try {
        await responseInterceptor(error);
      } catch (e) {
        // Should reject immediately without attempting refresh
        expect(global.fetch).not.toHaveBeenCalled();
        expect(e).toBe(error);
      }
    });
  });

  describe('Token Management', () => {
    it('should store tokens correctly', async () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      };

      await apiClient.storeTokens(tokens);

      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('access_token', tokens.accessToken);
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', tokens.refreshToken);
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('id_token', tokens.idToken);
    });

    it('should retrieve stored tokens correctly', async () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      };

      mockedSecureStore.getItemAsync.mockImplementation((key) => {
        if (key === 'access_token') return Promise.resolve(tokens.accessToken);
        if (key === 'refresh_token') return Promise.resolve(tokens.refreshToken);
        if (key === 'id_token') return Promise.resolve(tokens.idToken);
        return Promise.resolve(null);
      });

      const result = await apiClient.getStoredTokens();

      expect(result).toEqual({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
      });
    });

    it('should clear tokens on signOut', async () => {
      await apiClient.signOut();

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('id_token');
    });
  });

  describe('HTTP Methods', () => {
    beforeEach(() => {
      // Reset the mocks for HTTP method tests
      mockAxiosInstance.get.mockResolvedValue({ data: 'get-response' });
      mockAxiosInstance.post.mockResolvedValue({ data: 'post-response' });
      mockAxiosInstance.put.mockResolvedValue({ data: 'put-response' });
      mockAxiosInstance.delete.mockResolvedValue({ data: 'delete-response' });
    });

    it('should make GET requests correctly', async () => {
      const result = await apiClient.get('/test');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/test', undefined);
      expect(result).toBe('get-response');
    });

    it('should make POST requests correctly', async () => {
      const data = { test: 'data' };
      const result = await apiClient.post('/test', data);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/test', data, undefined);
      expect(result).toBe('post-response');
    });

    it('should make PUT requests correctly', async () => {
      const data = { test: 'data' };
      const result = await apiClient.put('/test', data);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/test', data, undefined);
      expect(result).toBe('put-response');
    });

    it('should make DELETE requests correctly', async () => {
      const result = await apiClient.delete('/test');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/test', undefined);
      expect(result).toBe('delete-response');
    });
  });
});