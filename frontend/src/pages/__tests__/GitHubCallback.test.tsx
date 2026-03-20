import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GitHubCallback } from '../GitHubCallback';

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
    githubCallback: vi.fn(),
    getMe: vi.fn(),
  },
}));

describe('GitHubCallback', () => {
  const mockOriginalLocation = window.location;

  beforeEach(() => {
    // Mock window.location
    delete (window as Window & typeof globalThis).location;
    window.location = {
      ...mockOriginalLocation,
      href: '',
      origin: 'https://workermill.com'
    };
  });

  afterEach(() => {
    window.location = mockOriginalLocation;
    vi.clearAllMocks();
  });

  it('redirects to mobile deep link when state starts with mobile_', () => {
    const searchParams = new URLSearchParams({
      code: 'test-auth-code',
      state: 'mobile_test-state-123'
    });

    render(
      <MemoryRouter initialEntries={[`/auth/github/callback?${searchParams.toString()}`]}>
        <GitHubCallback />
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
      <MemoryRouter initialEntries={[`/auth/github/callback?${searchParams.toString()}`]}>
        <GitHubCallback />
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
      <MemoryRouter initialEntries={[`/auth/github/callback?${searchParams.toString()}`]}>
        <GitHubCallback />
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
      <MemoryRouter initialEntries={[`/auth/github/callback?${searchParams.toString()}`]}>
        <GitHubCallback />
      </MemoryRouter>
    );

    // Should properly encode the code parameter
    expect(window.location.href).toBe('workermill://auth/callback?code=test-code-with-special-chars%26%3D');
  });
});