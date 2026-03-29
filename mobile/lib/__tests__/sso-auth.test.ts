import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { SsoAuthManager, getSsoConfig, signInWithProvider } from '../sso-auth';
import { API_BASE_URL } from '@/constants/config';

// Mock dependencies
jest.mock('expo-web-browser');
jest.mock('expo-crypto');
jest.mock('@/constants/config', () => ({
  API_BASE_URL: 'https://workermill.com/api',
}));

const mockWebBrowser = WebBrowser as jest.Mocked<typeof WebBrowser>;
const mockCrypto = Crypto as jest.Mocked<typeof Crypto>;

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('SsoAuthManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCrypto.randomUUID.mockReturnValue('test-uuid-123');
    // Mock PKCE methods — needed by signInWithProvider before any fetch call
    mockCrypto.getRandomBytesAsync.mockResolvedValue(new Uint8Array(64));
    mockCrypto.digestStringAsync.mockResolvedValue('dGVzdC1jb2RlLWNoYWxsZW5nZQ==');
  });

  describe('getSsoConfig', () => {
    it('fetches SSO configuration from API', async () => {
      const mockConfig = {
        providers: [
          { name: 'GitHub', displayName: 'GitHub' },
          { name: 'Google', displayName: 'Google' },
        ],
        clientId: 'test-client-id',
        hostedUiBaseUrl: 'https://auth.example.com',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } as Response);

      const result = await getSsoConfig();

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE_URL}/auth/sso-config`);
      expect(result).toEqual(mockConfig);
    });

    it('throws error when API request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(getSsoConfig()).rejects.toThrow('Failed to fetch SSO config: 500');
    });
  });

  describe('signInWithProvider', () => {
    const mockSsoConfig = {
      providers: [
        { name: 'GitHub', displayName: 'GitHub' },
        { name: 'Google', displayName: 'Google' },
      ],
      clientId: 'test-client-id',
      hostedUiBaseUrl: 'https://auth.example.com',
    };

    describe('GitHub provider', () => {
      it('correctly prefixes state with mobile_ for GitHub', async () => {
        const mockGitHubResponse = {
          authorizeUrl: 'https://github.com/login/oauth/authorize?state=server-state',
          state: 'server-state',
        };

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockGitHubResponse),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              accessToken: 'test-access-token',
              refreshToken: 'test-refresh-token',
              idToken: 'test-id-token',
            }),
          } as Response);

        mockWebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
          type: 'success',
          url: 'workermill://auth/callback?code=test-code&state=mobile_test-uuid-123',
        } as any);

        const result = await signInWithProvider('GitHub', mockSsoConfig);

        // Verify authorize URL request
        expect(mockFetch).toHaveBeenNthCalledWith(1, `${API_BASE_URL}/auth/github/authorize`);

        // Verify browser opened with mobile-prefixed state and PKCE code challenge
        expect(mockWebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          expect.stringContaining('state=mobile_test-uuid-123'),
          'workermill://auth/callback'
        );
        expect(mockWebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          expect.stringContaining('code_challenge='),
          'workermill://auth/callback'
        );

        // Verify token exchange used GitHub callback endpoint with codeVerifier
        expect(mockFetch).toHaveBeenNthCalledWith(2, `${API_BASE_URL}/auth/github/callback`, expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }));
        // Body should include code, codeVerifier, and redirectUri
        const callBody = JSON.parse((mockFetch.mock.calls[1][1] as any).body);
        expect(callBody.code).toBe('test-code');
        expect(callBody.codeVerifier).toBeDefined();
        expect(callBody.redirectUri).toBe('https://workermill.com/auth/github/callback');

        expect(result.success).toBe(true);
        expect(result.data?.accessToken).toBe('test-access-token');
      });
    });

    describe('Cognito providers (Google, Microsoft, Apple, Facebook)', () => {
      it('correctly builds Cognito authorize URL for Google', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            idToken: 'test-id-token',
          }),
        } as Response);

        mockWebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
          type: 'success',
          url: 'workermill://auth/callback?code=test-code&state=mobile_test-uuid-123',
        } as any);

        const result = await signInWithProvider('Google', mockSsoConfig);

        // Verify browser opened with correct Cognito URL including PKCE challenge
        const openCall = mockWebBrowser.openAuthSessionAsync.mock.calls[0];
        const authorizeUrl = openCall[0] as string;
        expect(authorizeUrl).toContain('identity_provider=Google');
        expect(authorizeUrl).toContain('client_id=test-client-id');
        expect(authorizeUrl).toContain('state=mobile_test-uuid-123');
        expect(authorizeUrl).toContain('code_challenge=');
        expect(authorizeUrl).toContain('code_challenge_method=S256');
        expect(openCall[1]).toBe('workermill://auth/callback');

        // Verify token exchange used SSO callback endpoint with codeVerifier
        expect(mockFetch).toHaveBeenCalledWith(`${API_BASE_URL}/auth/sso-callback`, expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }));
        const googleBody = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
        expect(googleBody.code).toBe('test-code');
        expect(googleBody.codeVerifier).toBeDefined();
        expect(googleBody.redirectUri).toBe('https://workermill.com/auth/callback');

        expect(result.success).toBe(true);
      });
    });

    describe('error handling', () => {
      it('handles cancelled authentication flow', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
          type: 'cancel',
        } as any);

        const result = await signInWithProvider('Google', mockSsoConfig);

        expect(result.success).toBe(false);
        expect(result.cancelled).toBe(true);
        expect(result.error).toBe('Sign-in was cancelled');
      });

      it('handles missing authorization code', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
          type: 'success',
          url: 'workermill://auth/callback?error=access_denied&state=mobile_test-uuid-123',
        } as any);

        const result = await signInWithProvider('Google', mockSsoConfig);

        expect(result.success).toBe(false);
        expect(result.error).toBe('No authorization code received from provider');
      });

      it('handles token exchange failure', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
          type: 'success',
          url: 'workermill://auth/callback?code=test-code&state=mobile_test-uuid-123',
        } as any);

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ message: 'Invalid code' }),
        } as Response);

        const result = await signInWithProvider('Google', mockSsoConfig);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid code');
      });

      it('handles network errors gracefully', async () => {
        mockWebBrowser.openAuthSessionAsync.mockRejectedValueOnce(new Error('Network error'));

        const result = await signInWithProvider('Google', mockSsoConfig);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Network error');
      });
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      // Mock getSsoConfig for convenience methods
      jest.spyOn(SsoAuthManager, 'getSsoConfig').mockResolvedValue({
        providers: [{ name: 'GitHub', displayName: 'GitHub' }],
        clientId: 'test-client-id',
        hostedUiBaseUrl: 'https://auth.example.com',
      });

      jest.spyOn(SsoAuthManager, 'signInWithProvider').mockResolvedValue({
        success: true,
        data: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          idToken: 'test-id-token',
        },
      });
    });

    it('signInWithGitHub calls signInWithProvider with GitHub', async () => {
      await SsoAuthManager.signInWithGitHub();

      expect(SsoAuthManager.signInWithProvider).toHaveBeenCalledWith('GitHub', expect.any(Object));
    });

    it('signInWithGoogle calls signInWithProvider with Google', async () => {
      await SsoAuthManager.signInWithGoogle();

      expect(SsoAuthManager.signInWithProvider).toHaveBeenCalledWith('Google', expect.any(Object));
    });
  });

  describe('utility methods', () => {
    it('getProviderDisplayName returns correct display names', () => {
      expect(SsoAuthManager.getProviderDisplayName('GitHub')).toBe('GitHub');
      expect(SsoAuthManager.getProviderDisplayName('Google')).toBe('Google');
      expect(SsoAuthManager.getProviderDisplayName('Unknown')).toBe('Unknown');
    });

    it('getProviderIconName returns correct icon names', () => {
      expect(SsoAuthManager.getProviderIconName('GitHub')).toBe('logo-github');
      expect(SsoAuthManager.getProviderIconName('Google')).toBe('logo-google');
      expect(SsoAuthManager.getProviderIconName('Unknown')).toBe('log-in');
    });

    it('isProviderAvailable checks provider existence', () => {
      const config = {
        providers: [{ name: 'GitHub', displayName: 'GitHub' }],
        clientId: 'test',
        hostedUiBaseUrl: 'test',
      };

      expect(SsoAuthManager.isProviderAvailable('GitHub', config)).toBe(true);
      expect(SsoAuthManager.isProviderAvailable('Google', config)).toBe(false);
    });
  });
});