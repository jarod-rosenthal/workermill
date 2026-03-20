import {
  getSsoConfig,
  signInWithProvider,
  isGitHubProvider,
  isCognitoProvider,
  getProviderInfo,
  validateSsoConfig,
  getAvailableProviders,
  findProvider,
} from '../sso-auth';

// Mock expo-web-browser
const mockWebBrowser = {
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
};

jest.mock('expo-web-browser', () => mockWebBrowser);

// Mock expo-crypto
const mockCrypto = {
  randomUUID: jest.fn(),
};

jest.mock('expo-crypto', () => mockCrypto);

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('SSO Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockCrypto.randomUUID.mockReturnValue('test-uuid-123');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  describe('getSsoConfig', () => {
    it('fetches SSO configuration successfully', async () => {
      const mockConfig = {
        providers: [
          { name: 'GitHub', displayName: 'GitHub' },
          { name: 'Google', displayName: 'Google' },
        ],
        clientId: 'test-client-id',
        hostedUiBaseUrl: 'https://auth.workermill.com',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      });

      const result = await getSsoConfig();

      expect(result).toEqual(mockConfig);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/sso-config')
      );
    });

    it('throws error when fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

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
      hostedUiBaseUrl: 'https://auth.workermill.com',
    };

    const mockAuthResult = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      user: {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        organizationId: 'org-123',
        organizationName: 'Test Org',
        role: 'member',
        mfaEnabled: false,
      },
    };

    describe('GitHub provider', () => {
      it('handles GitHub OAuth flow with mobile_ state prefix', async () => {
        const mockGitHubAuth = {
          authorizeUrl: 'https://github.com/login/oauth/authorize?state=github-state-123&client_id=test',
          state: 'github-state-123',
        };

        // Mock GitHub auth initialization
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockGitHubAuth),
          })
          // Mock token exchange
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockAuthResult),
          });

        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'success',
          url: 'workermill://auth/callback?code=test-code',
        });

        const result = await signInWithProvider('GitHub', mockSsoConfig);

        expect(result).toEqual(mockAuthResult);

        // Check that mobile_ state prefix was injected
        expect(mockWebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          expect.stringContaining('state=mobile_github-state-123'),
          'workermill://auth/callback'
        );

        // Check token exchange was called with GitHub callback endpoint
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/auth/github/callback'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              code: 'test-code',
              redirectUri: 'https://workermill.com/auth/github/callback',
            }),
          })
        );
      });

      it('handles GitHub auth initialization failure', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
        });

        await expect(
          signInWithProvider('GitHub', mockSsoConfig)
        ).rejects.toThrow('Failed to initialize GitHub auth: 400');
      });
    });

    describe('Cognito providers', () => {
      it('handles Google OAuth flow with mobile_ state prefix', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockAuthResult),
        });

        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'success',
          url: 'workermill://auth/callback?code=test-code',
        });

        const result = await signInWithProvider('Google', mockSsoConfig);

        expect(result).toEqual(mockAuthResult);

        // Check that Cognito authorize URL was built correctly with mobile_ state
        expect(mockWebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          expect.stringContaining('identity_provider=Google'),
          'workermill://auth/callback'
        );
        expect(mockWebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          expect.stringContaining('state=mobile_test-uuid-123'),
          'workermill://auth/callback'
        );
        expect(mockWebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          expect.stringContaining('client_id=test-client-id'),
          'workermill://auth/callback'
        );

        // Check token exchange was called with SSO callback endpoint
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/auth/sso-callback'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              code: 'test-code',
              redirectUri: 'https://workermill.com/auth/callback',
            }),
          })
        );
      });
    });

    describe('error handling', () => {
      it('throws CANCELLED error when user cancels', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'cancel',
        });

        await expect(
          signInWithProvider('Google', mockSsoConfig)
        ).rejects.toMatchObject({
          message: 'Sign-in was cancelled by user',
          code: 'CANCELLED',
        });
      });

      it('throws NO_CODE error when no authorization code received', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'success',
          url: 'workermill://auth/callback?error=access_denied',
        });

        await expect(
          signInWithProvider('Google', mockSsoConfig)
        ).rejects.toMatchObject({
          message: 'No authorization code received',
          code: 'NO_CODE',
        });
      });

      it('throws EXCHANGE_FAILED error when token exchange fails', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'success',
          url: 'workermill://auth/callback?code=test-code',
        });

        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Invalid request'),
        });

        await expect(
          signInWithProvider('Google', mockSsoConfig)
        ).rejects.toMatchObject({
          code: 'EXCHANGE_FAILED',
        });
      });

      it('throws NETWORK_ERROR for non-success browser result', async () => {
        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'error',
          error: 'Network error',
        });

        await expect(
          signInWithProvider('Google', mockSsoConfig)
        ).rejects.toMatchObject({
          code: 'NETWORK_ERROR',
        });
      });
    });

    describe('URL parsing', () => {
      it('extracts code from complex callback URLs', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockAuthResult),
        });

        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'success',
          url: 'workermill://auth/callback?code=complex-code-123&state=mobile_test&other=param',
        });

        await signInWithProvider('Google', mockSsoConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            body: JSON.stringify({
              code: 'complex-code-123',
              redirectUri: 'https://workermill.com/auth/callback',
            }),
          })
        );
      });

      it('handles URL encoding in authorization code', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockAuthResult),
        });

        mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
          type: 'success',
          url: 'workermill://auth/callback?code=code%2Bwith%2Bencoding',
        });

        await signInWithProvider('Google', mockSsoConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            body: JSON.stringify({
              code: 'code+with+encoding',
              redirectUri: 'https://workermill.com/auth/callback',
            }),
          })
        );
      });
    });
  });

  describe('provider utilities', () => {
    it('identifies GitHub provider correctly', () => {
      expect(isGitHubProvider('GitHub')).toBe(true);
      expect(isGitHubProvider('github')).toBe(true);
      expect(isGitHubProvider('Google')).toBe(false);
    });

    it('identifies Cognito providers correctly', () => {
      expect(isCognitoProvider('Google')).toBe(true);
      expect(isCognitoProvider('microsoft')).toBe(true);
      expect(isCognitoProvider('Apple')).toBe(true);
      expect(isCognitoProvider('facebook')).toBe(true);
      expect(isCognitoProvider('GitHub')).toBe(false);
      expect(isCognitoProvider('unknown')).toBe(false);
    });

    it('returns provider display information', () => {
      expect(getProviderInfo('GitHub')).toEqual({
        displayName: 'GitHub',
        icon: 'github',
        color: '#24292e',
      });

      expect(getProviderInfo('Google')).toEqual({
        displayName: 'Google',
        icon: 'google',
        color: '#4285f4',
      });

      expect(getProviderInfo('unknown')).toEqual({
        displayName: 'unknown',
        icon: 'account',
        color: '#666666',
      });
    });
  });

  describe('configuration validation', () => {
    it('validates correct SSO config', () => {
      const validConfig = {
        providers: [
          { name: 'GitHub', displayName: 'GitHub' },
          { name: 'Google', displayName: 'Google' },
        ],
        clientId: 'test-client-id',
        hostedUiBaseUrl: 'https://auth.workermill.com',
      };

      expect(validateSsoConfig(validConfig)).toBe(true);
    });

    it('rejects invalid SSO config', () => {
      expect(validateSsoConfig(null)).toBe(false);
      expect(validateSsoConfig({})).toBe(false);
      expect(validateSsoConfig({ providers: 'not-array' })).toBe(false);
      expect(validateSsoConfig({
        providers: [{ name: 'test' }], // missing displayName
        clientId: 'test',
        hostedUiBaseUrl: 'https://test.com',
      })).toBe(false);
    });

    it('gets available providers from config', () => {
      const config = {
        providers: [
          { name: 'GitHub', displayName: 'GitHub' },
          { name: 'Google', displayName: 'Google' },
        ],
        clientId: 'test',
        hostedUiBaseUrl: 'https://test.com',
      };

      expect(getAvailableProviders(config)).toEqual(['GitHub', 'Google']);
    });

    it('finds provider by name', () => {
      const config = {
        providers: [
          { name: 'GitHub', displayName: 'GitHub' },
          { name: 'Google', displayName: 'Google' },
        ],
        clientId: 'test',
        hostedUiBaseUrl: 'https://test.com',
      };

      expect(findProvider(config, 'GitHub')).toEqual({
        name: 'GitHub',
        displayName: 'GitHub',
      });

      expect(findProvider(config, 'github')).toEqual({
        name: 'GitHub',
        displayName: 'GitHub',
      });

      expect(findProvider(config, 'Unknown')).toBe(null);
    });
  });
});