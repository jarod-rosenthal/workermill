/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthCallback } from '../AuthCallback';

// Mock hooks
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(window.location.search)],
  };
});

// Mock auth store
const mockSetTokens = vi.fn();
const mockSetUser = vi.fn();
const mockSetOrganization = vi.fn();
const mockSetNeedsSetup = vi.fn();

vi.mock('../../store/auth-store', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      setTokens: mockSetTokens,
      setUser: mockSetUser,
      setOrganization: mockSetOrganization,
      setNeedsSetup: mockSetNeedsSetup,
    };
    return selector(state);
  }),
}));

// Mock API client
const mockSsoCallback = vi.fn();
const mockGetMe = vi.fn();

vi.mock('../../lib/api-client', () => ({
  default: {
    post: vi.fn(),
  },
  authAPI: {
    ssoCallback: mockSsoCallback,
    getMe: mockGetMe,
  },
}));

// Mock window location
const mockLocationAssign = vi.fn();
Object.defineProperty(window, 'location', {
  value: {
    href: '',
    origin: 'https://workermill.com',
    search: '',
    assign: mockLocationAssign,
  },
  writable: true,
});

// Mock session storage
const mockSessionStorage = {
  getItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
  writable: true,
});

// Mock atob for state parameter decoding
global.atob = vi.fn();

const renderAuthCallback = (searchParams = '') => {
  window.location.search = searchParams;
  return render(
    <BrowserRouter>
      <AuthCallback />
    </BrowserRouter>
  );
};

describe('AuthCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = '';
    mockSessionStorage.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('mobile state redirect', () => {
    it('redirects to workermill:// when state starts with mobile_', async () => {
      const code = 'test-auth-code';
      const mobileState = 'mobile_cognito_state_123';

      renderAuthCallback(`?code=${code}&state=${mobileState}`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=${encodeURIComponent(code)}`
        );
      });

      // Should not call the SSO callback API
      expect(mockSsoCallback).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('redirects to workermill:// with encoded special characters in code', async () => {
      const code = 'test+code/with=special&chars';
      const mobileState = 'mobile_google_xyz789';

      renderAuthCallback(`?code=${encodeURIComponent(code)}&state=${mobileState}`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=${encodeURIComponent(code)}`
        );
      });
    });

    it('redirects to workermill:// even when code is null', async () => {
      const mobileState = 'mobile_microsoft_error_case';

      renderAuthCallback(`?state=${mobileState}&error=access_denied`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=`
        );
      });

      // Should not process the error normally
      expect(mockSsoCallback).not.toHaveBeenCalled();
    });

    it('handles mobile state with complex parameters', async () => {
      const code = 'complex-auth-code-123';
      const mobileState = 'mobile_apple_with_underscores_and_numbers_456';

      renderAuthCallback(`?code=${code}&state=${mobileState}&extra=param&another=value`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=${encodeURIComponent(code)}`
        );
      });
    });
  });

  describe('non-mobile state handling', () => {
    it('processes normally when state does not start with mobile_', async () => {
      const code = 'test-auth-code';
      const regularState = 'cognito-regular-state-123';

      const mockSsoResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
      };

      const mockMeResponse = {
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
        },
        organization: {
          id: 'org-1',
          name: 'Test Org',
        },
        needsSetup: false,
      };

      mockSsoCallback.mockResolvedValue(mockSsoResponse);
      mockGetMe.mockResolvedValue(mockMeResponse);

      renderAuthCallback(`?code=${code}&state=${regularState}`);

      await waitFor(() => {
        expect(mockSsoCallback).toHaveBeenCalledWith({
          code,
          redirectUri: 'https://workermill.com/auth/callback',
        });
      });

      await waitFor(() => {
        expect(mockGetMe).toHaveBeenCalled();
      });

      expect(mockSetTokens).toHaveBeenCalledWith(mockSsoResponse.tokens);
      expect(mockSetUser).toHaveBeenCalledWith(mockMeResponse.user);
      expect(mockSetOrganization).toHaveBeenCalledWith(mockMeResponse.organization);
      expect(mockSetNeedsSetup).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');

      // Should not redirect to mobile deep link
      expect(window.location.href).not.toContain('workermill://');
    });

    it('processes normally when state is null', async () => {
      const code = 'test-auth-code';

      const mockSsoResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
      };

      const mockMeResponse = {
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
        needsSetup: false,
      };

      mockSsoCallback.mockResolvedValue(mockSsoResponse);
      mockGetMe.mockResolvedValue(mockMeResponse);

      renderAuthCallback(`?code=${code}`);

      await waitFor(() => {
        expect(mockSsoCallback).toHaveBeenCalledWith({
          code,
          redirectUri: 'https://workermill.com/auth/callback',
        });
      });

      // Should not redirect to mobile deep link
      expect(window.location.href).not.toContain('workermill://');
    });

    it('processes normally when state is empty string', async () => {
      const code = 'test-auth-code';

      const mockSsoResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
      };

      const mockMeResponse = {
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
        needsSetup: false,
      };

      mockSsoCallback.mockResolvedValue(mockSsoResponse);
      mockGetMe.mockResolvedValue(mockMeResponse);

      renderAuthCallback(`?code=${code}&state=`);

      await waitFor(() => {
        expect(mockSsoCallback).toHaveBeenCalledWith({
          code,
          redirectUri: 'https://workermill.com/auth/callback',
        });
      });

      // Should not redirect to mobile deep link
      expect(window.location.href).not.toContain('workermill://');
    });

    it('navigates to onboarding when needsSetup is true', async () => {
      const code = 'test-code';
      const state = 'normal-state';

      const mockSsoResponse = {
        tokens: { accessToken: 'token', refreshToken: 'refresh', idToken: 'id' },
      };

      const mockMeResponse = {
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
        needsSetup: true,
      };

      mockSsoCallback.mockResolvedValue(mockSsoResponse);
      mockGetMe.mockResolvedValue(mockMeResponse);

      renderAuthCallback(`?code=${code}&state=${state}`);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/onboarding');
      });

      expect(window.location.href).not.toContain('workermill://');
    });
  });

  describe('edge cases', () => {
    it('handles state that contains but does not start with mobile_', async () => {
      const code = 'test-code';
      const state = 'some-mobile_state-suffix';

      const mockSsoResponse = {
        tokens: { accessToken: 'token', refreshToken: 'refresh', idToken: 'id' },
      };

      const mockMeResponse = {
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
        needsSetup: false,
      };

      mockSsoCallback.mockResolvedValue(mockSsoResponse);
      mockGetMe.mockResolvedValue(mockMeResponse);

      renderAuthCallback(`?code=${code}&state=${state}`);

      await waitFor(() => {
        expect(mockSsoCallback).toHaveBeenCalled();
      });

      // Should NOT redirect to mobile because state doesn't START with mobile_
      expect(window.location.href).not.toContain('workermill://');
    });

    it('handles mobile_ state case sensitively (only exact match)', async () => {
      const code = 'test-code';
      const state = 'MOBILE_uppercase';

      const mockSsoResponse = {
        tokens: { accessToken: 'token', refreshToken: 'refresh', idToken: 'id' },
      };

      const mockMeResponse = {
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
        needsSetup: false,
      };

      mockSsoCallback.mockResolvedValue(mockSsoResponse);
      mockGetMe.mockResolvedValue(mockMeResponse);

      renderAuthCallback(`?code=${code}&state=${state}`);

      await waitFor(() => {
        expect(mockSsoCallback).toHaveBeenCalled();
      });

      // Should NOT redirect to mobile because it's case sensitive
      expect(window.location.href).not.toContain('workermill://');
    });
  });

  describe('error handling with mobile state', () => {
    it('redirects to mobile even when OAuth error present but state is mobile', async () => {
      const mobileState = 'mobile_error_case';

      renderAuthCallback(`?error=access_denied&error_description=User%20denied&state=${mobileState}`);

      await waitFor(() => {
        expect(window.location.href).toBe('workermill://auth/callback?code=');
      });

      // Should not process the error normally
      expect(mockSsoCallback).not.toHaveBeenCalled();
    });
  });

  describe('invite token handling with mobile state', () => {
    it('does not process invite tokens when redirecting to mobile', async () => {
      const code = 'test-code';
      const mobileState = 'mobile_with_invite';

      // Mock session storage with invite token
      mockSessionStorage.getItem.mockReturnValue('invite-token-123');

      renderAuthCallback(`?code=${code}&state=${mobileState}`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=${encodeURIComponent(code)}`
        );
      });

      // Should not process invite or call SSO callback
      expect(mockSsoCallback).not.toHaveBeenCalled();
      expect(mockSessionStorage.removeItem).not.toHaveBeenCalled();
    });
  });
});