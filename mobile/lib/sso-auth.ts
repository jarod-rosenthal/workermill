import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { API_BASE_URL } from '@/constants/config';

// Types
export interface SsoConfig {
  providers: { name: string; displayName: string }[];
  clientId: string;
  hostedUiBaseUrl: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    organizationId: string;
    organizationName: string;
    role: string;
    mfaEnabled: boolean;
  };
}

export interface SignInError extends Error {
  code: 'CANCELLED' | 'NO_CODE' | 'EXCHANGE_FAILED' | 'NETWORK_ERROR';
}

// Configure WebBrowser for better UX
WebBrowser.maybeCompleteAuthSession();

/**
 * Fetch SSO configuration from the server
 */
export async function getSsoConfig(): Promise<SsoConfig> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/sso-config`);

    if (!response.ok) {
      throw new Error(`Failed to fetch SSO config: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get SSO config:', error);
    throw error;
  }
}

/**
 * Sign in with any SSO provider
 */
export async function signInWithProvider(
  providerName: string,
  ssoConfig: SsoConfig
): Promise<AuthResult> {
  try {
    let authorizeUrl: string;
    let callbackEndpoint: string;
    let redirectUri: string;

    if (providerName === 'GitHub') {
      // GitHub uses direct OAuth, not Cognito Hosted UI
      const authResult = await initializeGitHubAuth();
      authorizeUrl = injectMobileState(authResult.authorizeUrl, authResult.state);
      callbackEndpoint = `${API_BASE_URL}/auth/github/callback`;
      redirectUri = 'https://workermill.com/auth/github/callback';
    } else {
      // Cognito providers (Google, Microsoft, Apple, Facebook)
      const state = `mobile_${Crypto.randomUUID()}`;
      redirectUri = 'https://workermill.com/auth/callback';
      const encodedRedirectUri = encodeURIComponent(redirectUri);

      authorizeUrl = `${ssoConfig.hostedUiBaseUrl}/oauth2/authorize` +
        `?identity_provider=${providerName}` +
        `&client_id=${ssoConfig.clientId}` +
        `&response_type=code` +
        `&scope=openid+email+profile` +
        `&redirect_uri=${encodedRedirectUri}` +
        `&state=${state}`;

      callbackEndpoint = `${API_BASE_URL}/auth/sso-callback`;
    }

    console.log('Opening SSO auth URL:', authorizeUrl);

    // Open browser and wait for workermill:// redirect
    const result = await WebBrowser.openAuthSessionAsync(
      authorizeUrl,
      'workermill://auth/callback'
    );

    if (result.type === 'cancel') {
      const error = new Error('Sign-in was cancelled by user') as SignInError;
      error.code = 'CANCELLED';
      throw error;
    }

    if (result.type !== 'success') {
      const error = new Error(`Auth session failed: ${result.type}`) as SignInError;
      error.code = 'NETWORK_ERROR';
      throw error;
    }

    // Extract code from redirect URL
    const code = extractCodeFromUrl(result.url);
    if (!code) {
      const error = new Error('No authorization code received') as SignInError;
      error.code = 'NO_CODE';
      throw error;
    }

    // Exchange code for tokens
    console.log('Exchanging authorization code for tokens...');
    const tokenResult = await exchangeCodeForTokens(callbackEndpoint, code, redirectUri);

    return tokenResult;

  } catch (error) {
    console.error('SSO sign-in failed:', error);

    if ((error as SignInError).code) {
      throw error;
    }

    const authError = new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`) as SignInError;
    authError.code = 'EXCHANGE_FAILED';
    throw authError;
  }
}

/**
 * Initialize GitHub OAuth flow
 */
async function initializeGitHubAuth(): Promise<{ authorizeUrl: string; state: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/github/authorize`);

    if (!response.ok) {
      throw new Error(`Failed to initialize GitHub auth: ${response.status}`);
    }

    const data = await response.json();
    return {
      authorizeUrl: data.authorizeUrl,
      state: data.state,
    };
  } catch (error) {
    console.error('Failed to initialize GitHub auth:', error);
    throw error;
  }
}

/**
 * Inject mobile_ prefix into OAuth state parameter
 */
function injectMobileState(url: string, originalState: string): string {
  try {
    const urlObj = new URL(url);
    const mobileState = `mobile_${originalState}`;
    urlObj.searchParams.set('state', mobileState);
    return urlObj.toString();
  } catch (error) {
    console.error('Failed to inject mobile state:', error);
    // Fallback: simple string replacement
    return url.replace(`state=${originalState}`, `state=mobile_${originalState}`);
  }
}

/**
 * Extract authorization code from callback URL
 */
function extractCodeFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get('code');
  } catch (error) {
    console.error('Failed to extract code from URL:', error);

    // Fallback: regex parsing
    const codeMatch = url.match(/[?&]code=([^&]+)/);
    return codeMatch ? decodeURIComponent(codeMatch[1]) : null;
  }
}

/**
 * Exchange authorization code for JWT tokens
 */
async function exchangeCodeForTokens(
  endpoint: string,
  code: string,
  redirectUri: string
): Promise<AuthResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    // Validate response structure
    if (!result.accessToken || !result.refreshToken || !result.idToken || !result.user) {
      throw new Error('Invalid token exchange response: missing required fields');
    }

    return result;
  } catch (error) {
    console.error('Token exchange failed:', error);
    throw error;
  }
}

/**
 * Check if provider is GitHub (for special handling)
 */
export function isGitHubProvider(providerName: string): boolean {
  return providerName.toLowerCase() === 'github';
}

/**
 * Check if provider is Cognito-based (Google, Microsoft, Apple, Facebook)
 */
export function isCognitoProvider(providerName: string): boolean {
  const cognitoProviders = ['google', 'microsoft', 'apple', 'facebook'];
  return cognitoProviders.includes(providerName.toLowerCase());
}

/**
 * Get provider display information
 */
export function getProviderInfo(providerName: string): {
  displayName: string;
  icon: string;
  color: string;
} {
  const providers: Record<string, { displayName: string; icon: string; color: string }> = {
    github: { displayName: 'GitHub', icon: 'github', color: '#24292e' },
    google: { displayName: 'Google', icon: 'google', color: '#4285f4' },
    microsoft: { displayName: 'Microsoft', icon: 'microsoft', color: '#00a1f1' },
    apple: { displayName: 'Apple', icon: 'apple', color: '#000000' },
    facebook: { displayName: 'Facebook', icon: 'facebook', color: '#1877f2' },
  };

  return providers[providerName.toLowerCase()] || {
    displayName: providerName,
    icon: 'account',
    color: '#666666',
  };
}

/**
 * Validate SSO configuration
 */
export function validateSsoConfig(config: any): config is SsoConfig {
  return (
    config &&
    typeof config === 'object' &&
    Array.isArray(config.providers) &&
    typeof config.clientId === 'string' &&
    typeof config.hostedUiBaseUrl === 'string' &&
    config.providers.every((p: any) =>
      p &&
      typeof p === 'object' &&
      typeof p.name === 'string' &&
      typeof p.displayName === 'string'
    )
  );
}

/**
 * Get available provider names from config
 */
export function getAvailableProviders(config: SsoConfig): string[] {
  return config.providers.map(p => p.name);
}

/**
 * Find provider by name in config
 */
export function findProvider(
  config: SsoConfig,
  name: string
): { name: string; displayName: string } | null {
  return config.providers.find(p =>
    p.name.toLowerCase() === name.toLowerCase()
  ) || null;
}