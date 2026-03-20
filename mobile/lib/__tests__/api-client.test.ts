import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { tokenManager } from '../api-client';

// Mock dependencies
jest.mock('axios');
jest.mock('expo-secure-store');
jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

// Mock fetch globally
global.fetch = jest.fn();

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockedRouter = router as jest.Mocked<typeof router>;
const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset axios create mock to return a fresh instance
    mockedAxios.create.mockReturnValue({
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as any);
  });

  describe('Request Interceptor', () => {
    it('should add authorization header when access token exists', async () => {
      const mockAccessToken = 'test-access-token';
      mockedSecureStore.getItemAsync.mockResolvedValue(mockAccessToken);

      // Get the request interceptor function
      const requestInterceptor = mockedAxios.create().interceptors.request.use;
      const interceptorCall = (requestInterceptor as jest.Mock).mock.calls[0];
      const requestHandler = interceptorCall[0];

      const config = { headers: {} as any };
      await requestHandler(config);

      expect(config.headers.Authorization).toBe(`Bearer ${mockAccessToken}`);
      expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('access_token');
    });

    it('should not add authorization header when no access token', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      const requestInterceptor = mockedAxios.create().interceptors.request.use;
      const interceptorCall = (requestInterceptor as jest.Mock).mock.calls[0];
      const requestHandler = interceptorCall[0];

      const config = { headers: {} as any };
      await requestHandler(config);

      expect(config.headers.Authorization).toBeUndefined();
    });

    it('should handle secure store errors gracefully', async () => {
      mockedSecureStore.getItemAsync.mockRejectedValue(new Error('Storage error'));
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const requestInterceptor = mockedAxios.create().interceptors.request.use;
      const interceptorCall = (requestInterceptor as jest.Mock).mock.calls[0];
      const requestHandler = interceptorCall[0];

      const config = { headers: {} as any };
      await requestHandler(config);

      expect(config.headers.Authorization).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read access token from secure store:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Response Interceptor - Token Refresh', () => {
    it('should refresh token on 401 error with correct Cognito request', async () => {
      const mockRefreshToken = 'test-refresh-token';
      const mockNewAccessToken = 'new-access-token';
      const mockNewIdToken = 'new-id-token';

      // Mock secure store responses
      mockedSecureStore.getItemAsync.mockResolvedValue(mockRefreshToken);
      mockedSecureStore.setItemAsync.mockResolvedValue();

      // Mock successful Cognito refresh response
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          AuthenticationResult: {
            AccessToken: mockNewAccessToken,
            IdToken: mockNewIdToken,
            ExpiresIn: 3600,
            TokenType: 'Bearer',
          },
        }),
      } as Response);

      // Mock the retry request
      const mockAxiosInstance = {
        request: jest.fn().mockResolvedValue({ data: 'success' }),
      };
      mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

      const responseInterceptor = mockedAxios.create().interceptors.response.use;
      const interceptorCall = (responseInterceptor as jest.Mock).mock.calls[0];
      const errorHandler = interceptorCall[1];

      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: false },
      };

      await errorHandler(error);

      // Verify Cognito refresh request
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://cognito-idp.us-east-1.amazonaws.com/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
          },
          body: JSON.stringify({
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || 'LOCAL_DEV_PLACEHOLDER',
            AuthParameters: {
              REFRESH_TOKEN: mockRefreshToken,
            },
          }),
        }
      );

      // Verify new tokens are stored
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        'access_token',
        mockNewAccessToken
      );
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('id_token', mockNewIdToken);

      // Verify refresh token is not overwritten (not included in response)
      expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalledWith(
        'refresh_token',
        expect.anything()
      );
    });

    it('should clear tokens and navigate to sign-in on refresh failure', async () => {
      const mockRefreshToken = 'test-refresh-token';
      mockedSecureStore.getItemAsync.mockResolvedValue(mockRefreshToken);
      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      // Mock failed Cognito refresh response
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const responseInterceptor = mockedAxios.create().interceptors.response.use;
      const interceptorCall = (responseInterceptor as jest.Mock).mock.calls[0];
      const errorHandler = interceptorCall[1];

      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: false },
      };

      await expect(errorHandler(error)).rejects.toThrow('Token refresh failed: 400');

      // Verify tokens are cleared
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('id_token');

      // Verify navigation to sign-in
      expect(mockedRouter.replace).toHaveBeenCalledWith('/(auth)/sign-in');
    });

    it('should not refresh token when no refresh token is available', async () => {
      mockedSecureStore.getItemAsync.mockResolvedValue(null);
      mockedSecureStore.deleteItemAsync.mockResolvedValue();

      const responseInterceptor = mockedAxios.create().interceptors.response.use;
      const interceptorCall = (responseInterceptor as jest.Mock).mock.calls[0];
      const errorHandler = interceptorCall[1];

      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: false },
      };

      await expect(errorHandler(error)).rejects.toThrow('No refresh token available');

      // Should not call Cognito refresh endpoint
      expect(mockedFetch).not.toHaveBeenCalled();

      // Should still clear tokens and navigate
      expect(mockedRouter.replace).toHaveBeenCalledWith('/(auth)/sign-in');
    });

    it('should pass through non-401 errors without refresh attempt', async () => {
      const responseInterceptor = mockedAxios.create().interceptors.response.use;
      const interceptorCall = (responseInterceptor as jest.Mock).mock.calls[0];
      const errorHandler = interceptorCall[1];

      const error = {
        response: { status: 500 },
        config: { headers: {} },
      };

      await expect(errorHandler(error)).rejects.toBe(error);

      // Should not attempt refresh
      expect(mockedFetch).not.toHaveBeenCalled();
      expect(mockedRouter.replace).not.toHaveBeenCalled();
    });

    it('should not retry if request already has _retry flag', async () => {
      const responseInterceptor = mockedAxios.create().interceptors.response.use;
      const interceptorCall = (responseInterceptor as jest.Mock).mock.calls[0];
      const errorHandler = interceptorCall[1];

      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: true },
      };

      await expect(errorHandler(error)).rejects.toBe(error);

      // Should not attempt refresh
      expect(mockedFetch).not.toHaveBeenCalled();
    });
  });

  describe('Token Manager', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('getAccessToken', () => {
      it('should return access token from secure store', async () => {
        const mockToken = 'test-access-token';
        mockedSecureStore.getItemAsync.mockResolvedValue(mockToken);

        const result = await tokenManager.getAccessToken();

        expect(result).toBe(mockToken);
        expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('access_token');
      });

      it('should return null and log warning on storage error', async () => {
        mockedSecureStore.getItemAsync.mockRejectedValue(new Error('Storage error'));
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const result = await tokenManager.getAccessToken();

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith('Failed to read access token:', expect.any(Error));

        consoleSpy.mockRestore();
      });
    });

    describe('setTokens', () => {
      it('should store all tokens in secure store', async () => {
        const tokens = {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        };

        mockedSecureStore.setItemAsync.mockResolvedValue();

        await tokenManager.setTokens(tokens);

        expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('access_token', tokens.accessToken);
        expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', tokens.refreshToken);
        expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('id_token', tokens.idToken);
      });

      it('should throw error if storage fails', async () => {
        const tokens = {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        };

        const storageError = new Error('Storage failed');
        mockedSecureStore.setItemAsync.mockRejectedValue(storageError);

        await expect(tokenManager.setTokens(tokens)).rejects.toThrow('Storage failed');
      });
    });

    describe('clearTokens', () => {
      it('should delete all tokens from secure store', async () => {
        mockedSecureStore.deleteItemAsync.mockResolvedValue();

        await tokenManager.clearTokens();

        expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('access_token');
        expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
        expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('id_token');
      });

      it('should handle delete errors gracefully', async () => {
        mockedSecureStore.deleteItemAsync.mockRejectedValue(new Error('Delete failed'));
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        await tokenManager.clearTokens();

        expect(consoleSpy).toHaveBeenCalledWith('Failed to clear tokens:', expect.any(Error));

        consoleSpy.mockRestore();
      });
    });

    describe('hasValidTokens', () => {
      it('should return true when both access and refresh tokens exist', async () => {
        mockedSecureStore.getItemAsync
          .mockResolvedValueOnce('access-token')
          .mockResolvedValueOnce('refresh-token');

        const result = await tokenManager.hasValidTokens();

        expect(result).toBe(true);
      });

      it('should return false when access token is missing', async () => {
        mockedSecureStore.getItemAsync
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce('refresh-token');

        const result = await tokenManager.hasValidTokens();

        expect(result).toBe(false);
      });

      it('should return false when refresh token is missing', async () => {
        mockedSecureStore.getItemAsync
          .mockResolvedValueOnce('access-token')
          .mockResolvedValueOnce(null);

        const result = await tokenManager.hasValidTokens();

        expect(result).toBe(false);
      });

      it('should return false on storage error', async () => {
        mockedSecureStore.getItemAsync.mockRejectedValue(new Error('Storage error'));
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const result = await tokenManager.hasValidTokens();

        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to check token validity:',
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });
  });
});