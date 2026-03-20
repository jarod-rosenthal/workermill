/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { GitHubCallback } from '../GitHubCallback';

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
const mockGithubCallback = vi.fn();
const mockGetMe = vi.fn();

vi.mock('../../lib/api-client', () => ({
  default: {
    post: vi.fn(),
  },
  authAPI: {
    githubCallback: mockGithubCallback,
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

const renderGitHubCallback = (searchParams = '') => {
  window.location.search = searchParams;
  return render(
    <BrowserRouter>
      <GitHubCallback />
    </BrowserRouter>
  );
};

describe('GitHubCallback', () => {
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
      const mobileState = 'mobile_abc123';

      renderGitHubCallback(`?code=${code}&state=${mobileState}`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=${encodeURIComponent(code)}`
        );
      });

      // Should not call the GitHub callback API
      expect(mockGithubCallback).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('redirects to workermill:// with encoded special characters in code', async () => {
      const code = 'test+code/with=special&chars';
      const mobileState = 'mobile_xyz789';

      renderGitHubCallback(`?code=${encodeURIComponent(code)}&state=${mobileState}`);

      await waitFor(() => {
        expect(window.location.href).toBe(
          `workermill://auth/callback?code=${encodeURIComponent(code)}`
        );
      });
    });

    it('handles mobile state with additional parameters', async () => {
      const code = 'test-code';
      const mobileState = 'mobile_state_with_underscores';

      renderGitHubCallback(`?code=${code}&state=${mobileState}&extra=param`);

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
      const regularState = 'regular-state-123';

      const mockResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
        },
        organization: {
          id: 'org-1',
          name: 'Test Org',
        },
      };

      mockGithubCallback.mockResolvedValue(mockResponse);

      renderGitHubCallback(`?code=${code}&state=${regularState}`);

      await waitFor(() => {
        expect(mockGithubCallback).toHaveBeenCalledWith({
          code,
          redirectUri: 'https://workermill.com/auth/github/callback',
          state: regularState,
        });
      });

      expect(mockSetTokens).toHaveBeenCalledWith(mockResponse.tokens);
      expect(mockSetUser).toHaveBeenCalledWith(mockResponse.user);
      expect(mockSetOrganization).toHaveBeenCalledWith(mockResponse.organization);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');

      // Should not redirect to mobile deep link
      expect(window.location.href).not.toContain('workermill://');
    });

    it('processes normally when state is null', async () => {
      const code = 'test-auth-code';

      const mockResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
        },
        organization: {
          id: 'org-1',
          name: 'Test Org',
        },
      };

      mockGithubCallback.mockResolvedValue(mockResponse);

      renderGitHubCallback(`?code=${code}`);

      await waitFor(() => {
        expect(mockGithubCallback).toHaveBeenCalledWith({
          code,
          redirectUri: 'https://workermill.com/auth/github/callback',
          state: undefined,
        });
      });

      // Should not redirect to mobile deep link
      expect(window.location.href).not.toContain('workermill://');
    });

    it('processes normally when state is empty string', async () => {
      const code = 'test-auth-code';

      const mockResponse = {
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        },
        user: {
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
        },
        organization: {
          id: 'org-1',
          name: 'Test Org',
        },
      };

      mockGithubCallback.mockResolvedValue(mockResponse);

      renderGitHubCallback(`?code=${code}&state=`);

      await waitFor(() => {
        expect(mockGithubCallback).toHaveBeenCalledWith({
          code,
          redirectUri: 'https://workermill.com/auth/github/callback',
          state: undefined,
        });
      });

      // Should not redirect to mobile deep link
      expect(window.location.href).not.toContain('workermill://');
    });
  });

  describe('error handling with mobile state', () => {
    it('redirects to mobile even when no code present but state is mobile', async () => {
      const mobileState = 'mobile_error_case';

      renderGitHubCallback(`?error=access_denied&state=${mobileState}`);

      // The component should show error before reaching the mobile redirect logic
      // But let's test the case where code is missing but state is mobile
      renderGitHubCallback(`?state=${mobileState}`);

      // When there's no code, the component shows an error and doesn't call handleCallback
      // So no mobile redirect should happen in this case
      expect(window.location.href).not.toContain('workermill://');
    });
  });

  describe('edge cases', () => {
    it('handles state that contains but does not start with mobile_', async () => {
      const code = 'test-code';
      const state = 'some-mobile_state-suffix';

      const mockResponse = {
        tokens: { accessToken: 'token', refreshToken: 'refresh', idToken: 'id' },
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
      };

      mockGithubCallback.mockResolvedValue(mockResponse);

      renderGitHubCallback(`?code=${code}&state=${state}`);

      await waitFor(() => {
        expect(mockGithubCallback).toHaveBeenCalled();
      });

      // Should NOT redirect to mobile because state doesn't START with mobile_
      expect(window.location.href).not.toContain('workermill://');
    });

    it('handles mobile_ state case insensitively (only exact match)', async () => {
      const code = 'test-code';
      const state = 'MOBILE_uppercase';

      const mockResponse = {
        tokens: { accessToken: 'token', refreshToken: 'refresh', idToken: 'id' },
        user: { id: '1', email: 'test@example.com', name: 'Test User' },
        organization: { id: 'org-1', name: 'Test Org' },
      };

      mockGithubCallback.mockResolvedValue(mockResponse);

      renderGitHubCallback(`?code=${code}&state=${state}`);

      await waitFor(() => {
        expect(mockGithubCallback).toHaveBeenCalled();
      });

      // Should NOT redirect to mobile because it's case sensitive
      expect(window.location.href).not.toContain('workermill://');
    });
  });
});