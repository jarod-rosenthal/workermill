import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthCallback } from '../AuthCallback';

// Mock the auth store
vi.mock('../../store/auth-store', () => ({
  useAuthStore: () => ({
    setTokens: vi.fn(),
    setUser: vi.fn(),
    setOrganization: vi.fn(),
    setNeedsSetup: vi.fn(),
  }),
}));

// Mock the API client
vi.mock('../../lib/api-client', () => ({
  default: {
    post: vi.fn(),
  },
  authAPI: {
    ssoCallback: vi.fn(),
    getMe: vi.fn(),
  },
}));

describe('AuthCallback', () => {
  const mockOriginalLocation = window.location;

  beforeEach(() => {
    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...mockOriginalLocation,
        href: '',
        origin: 'https://workermill.com'
      },
    });

    // Mock sessionStorage
    Object.defineProperty(globalThis, 'sessionStorage', {
      writable: true,
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { writable: true, value: mockOriginalLocation });
    vi.clearAllMocks();
  });

  it('redirects to mobile deep link when state starts with mobile_', () => {
    const searchParams = new URLSearchParams({
      code: 'test-auth-code',
      state: 'mobile_test-state-123'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/callback?${searchParams.toString()}`]}>
        <AuthCallback />
      </MemoryRouter>
    );

    // Should redirect to workermill:// deep link
    expect(window.location.href).toBe('workermill://auth/callback?code=test-auth-code');
  });

  it('does not redirect when state does not start with mobile_', () => {
    const searchParams = new URLSearchParams({
      code: 'test-auth-code',
      state: 'regular-state-123'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/callback?${searchParams.toString()}`]}>
        <AuthCallback />
      </MemoryRouter>
    );

    // Should not redirect to mobile deep link
    expect(window.location.href).not.toBe('workermill://auth/callback?code=test-auth-code');
  });

  it('does not redirect when state is null', () => {
    const searchParams = new URLSearchParams({
      code: 'test-auth-code'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/callback?${searchParams.toString()}`]}>
        <AuthCallback />
      </MemoryRouter>
    );

    // Should not redirect to mobile deep link
    expect(window.location.href).not.toBe('workermill://auth/callback?code=test-auth-code');
  });

  it('properly encodes the code parameter in mobile redirect URL', () => {
    const searchParams = new URLSearchParams({
      code: 'test-code-with-special-chars&=',
      state: 'mobile_test'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/callback?${searchParams.toString()}`]}>
        <AuthCallback />
      </MemoryRouter>
    );

    // Should properly encode the code parameter
    expect(window.location.href).toBe('workermill://auth/callback?code=test-code-with-special-chars%26%3D');
  });

  it('handles missing code parameter gracefully in mobile redirect', () => {
    const searchParams = new URLSearchParams({
      state: 'mobile_test'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/callback?${searchParams.toString()}`]}>
        <AuthCallback />
      </MemoryRouter>
    );

    // Should redirect with empty code parameter
    expect(window.location.href).toBe('workermill://auth/callback?code=');
  });

  it('processes normally for Cognito SSO providers when state does not start with mobile_', () => {
    const mockSsoCallback = vi.fn().mockResolvedValue({
      tokens: { accessToken: 'token', refreshToken: 'refresh', idToken: 'id' }
    });
    const mockGetMe = vi.fn().mockResolvedValue({
      user: { id: '1', email: 'test@example.com' },
      organization: { id: '1', name: 'Test Org' },
      needsSetup: false
    });

    // Import with the mocked API
    vi.doMock('../../lib/api-client', () => ({
      default: { post: vi.fn() },
      authAPI: {
        ssoCallback: mockSsoCallback,
        getMe: mockGetMe,
      },
    }));

    const searchParams = new URLSearchParams({
      code: 'test-auth-code',
      state: 'regular-cognito-state'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/callback?${searchParams.toString()}`]}>
        <AuthCallback />
      </MemoryRouter>
    );

    // Should not redirect to mobile deep link for normal web flow
    expect(window.location.href).not.toContain('workermill://');
  });
});