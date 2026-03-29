import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { API_BASE_URL } from '@/constants/config';

// Pending auth state for PKCE and CSRF validation
let pendingAuth: { state: string; codeVerifier: string } | null = null;

export interface SsoConfig {
  providers: { name: string; displayName: string }[];
  clientId: string;
  hostedUiBaseUrl: string;
}

export interface SsoTokenResult {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

export interface SsoAuthResult {
  success: boolean;
  data?: SsoTokenResult;
  error?: string;
  cancelled?: boolean;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class SsoAuthManager {
  /**
   * Generate a cryptographically random code verifier for PKCE
   */
  private static async generateCodeVerifier(): Promise<string> {
    const randomBytes = await Crypto.getRandomBytesAsync(64);
    return base64UrlEncode(randomBytes);
  }

  /**
   * Generate a code challenge from a code verifier using S256
   */
  private static async generateCodeChallenge(verifier: string): Promise<string> {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 }
    );
    // Convert standard base64 to base64url
    return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Get available SSO providers configuration from the API
   */
  static async getSsoConfig(): Promise<SsoConfig> {
    const response = await fetch(`${API_BASE_URL}/auth/sso-config`);

    if (!response.ok) {
      throw new Error(`Failed to fetch SSO config: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Sign in with any SSO provider (GitHub, Google, Microsoft, Apple, Facebook)
   */
  static async signInWithProvider(
    providerName: string,
    ssoConfig: SsoConfig,
  ): Promise<SsoAuthResult> {
    try {
      const state = `mobile_${Crypto.randomUUID()}`;
      const codeVerifier = await this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);
      pendingAuth = { state, codeVerifier };

      let authorizeUrl: string;
      let callbackEndpoint: string;

      if (providerName === "GitHub") {
        // GitHub uses direct OAuth, not Cognito Hosted UI
        const response = await fetch(`${API_BASE_URL}/auth/github/authorize`);

        if (!response.ok) {
          throw new Error(`GitHub authorize failed: ${response.status}`);
        }

        const { authorizeUrl: ghUrl, state: ghState } = await response.json();

        // Replace the server-generated state with our mobile-prefixed state
        authorizeUrl = ghUrl.replace(`state=${ghState}`, `state=${state}`) +
          `&code_challenge=${codeChallenge}&code_challenge_method=S256`;
        callbackEndpoint = `${API_BASE_URL}/auth/github/callback`;
      } else {
        // Cognito providers (Google, Microsoft, Apple, Facebook)
        const redirectUri = encodeURIComponent("https://workermill.com/auth/callback");
        authorizeUrl = `${ssoConfig.hostedUiBaseUrl}/oauth2/authorize` +
          `?identity_provider=${providerName}` +
          `&client_id=${ssoConfig.clientId}` +
          `&response_type=code` +
          `&scope=openid+email+profile` +
          `&redirect_uri=${redirectUri}` +
          `&state=${state}` +
          `&code_challenge=${codeChallenge}&code_challenge_method=S256`;
        callbackEndpoint = `${API_BASE_URL}/auth/sso-callback`;
      }

      // Open browser and wait for workermill:// redirect
      const result = await WebBrowser.openAuthSessionAsync(
        authorizeUrl,
        'workermill://auth/callback'
      );

      if (result.type !== 'success') {
        pendingAuth = null;
        return {
          success: false,
          cancelled: result.type === 'cancel',
          error: result.type === 'cancel' ? 'Sign-in was cancelled' : 'Authentication failed',
        };
      }

      // Extract code and validate state from redirect URL
      const url = new URL(result.url);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (returnedState !== pendingAuth?.state) {
        pendingAuth = null;
        return {
          success: false,
          error: 'Authentication state mismatch — possible CSRF attack',
        };
      }

      if (!code) {
        pendingAuth = null;
        return {
          success: false,
          error: 'No authorization code received from provider',
        };
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(callbackEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          codeVerifier: pendingAuth.codeVerifier,
          redirectUri: providerName === "GitHub"
            ? "https://workermill.com/auth/github/callback"
            : "https://workermill.com/auth/callback",
        }),
      });

      pendingAuth = null;

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `Authentication failed: ${tokenResponse.status}`,
        };
      }

      const tokenData = await tokenResponse.json();

      return {
        success: true,
        data: tokenData,
      };
    } catch (error) {
      pendingAuth = null;
      console.error('SSO authentication error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Sign in with GitHub (convenience method)
   */
  static async signInWithGitHub(): Promise<SsoAuthResult> {
    try {
      const ssoConfig = await this.getSsoConfig();
      return await this.signInWithProvider("GitHub", ssoConfig);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize GitHub sign-in',
      };
    }
  }

  /**
   * Sign in with Google (convenience method)
   */
  static async signInWithGoogle(): Promise<SsoAuthResult> {
    try {
      const ssoConfig = await this.getSsoConfig();
      return await this.signInWithProvider("Google", ssoConfig);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize Google sign-in',
      };
    }
  }

  /**
   * Sign in with Microsoft (convenience method)
   */
  static async signInWithMicrosoft(): Promise<SsoAuthResult> {
    try {
      const ssoConfig = await this.getSsoConfig();
      return await this.signInWithProvider("Microsoft", ssoConfig);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize Microsoft sign-in',
      };
    }
  }

  /**
   * Sign in with Apple (convenience method)
   */
  static async signInWithApple(): Promise<SsoAuthResult> {
    try {
      const ssoConfig = await this.getSsoConfig();
      return await this.signInWithProvider("Apple", ssoConfig);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize Apple sign-in',
      };
    }
  }

  /**
   * Get display name for a provider
   */
  static getProviderDisplayName(providerName: string): string {
    const displayNames: Record<string, string> = {
      'GitHub': 'GitHub',
      'Google': 'Google',
      'Microsoft': 'Microsoft',
      'Apple': 'Apple',
      'Facebook': 'Facebook',
    };

    return displayNames[providerName] || providerName;
  }

  /**
   * Get icon name for a provider (for use with @expo/vector-icons)
   */
  static getProviderIconName(providerName: string): string {
    const iconNames: Record<string, string> = {
      'GitHub': 'logo-github',
      'Google': 'logo-google',
      'Microsoft': 'logo-microsoft',
      'Apple': 'logo-apple',
      'Facebook': 'logo-facebook',
    };

    return iconNames[providerName] || 'log-in';
  }

  /**
   * Check if a provider is available in the SSO config
   */
  static isProviderAvailable(providerName: string, ssoConfig: SsoConfig): boolean {
    return ssoConfig.providers.some(provider => provider.name === providerName);
  }

  /**
   * Validate an auth state parameter (for deep link callback verification)
   */
  static validateAuthState(state: string): boolean {
    return pendingAuth !== null && pendingAuth.state === state;
  }
}

// Export convenience functions — bind methods that use `this` to call other static methods
export const getSsoConfig = SsoAuthManager.getSsoConfig.bind(SsoAuthManager);
export const signInWithProvider = SsoAuthManager.signInWithProvider.bind(SsoAuthManager);
export const signInWithGitHub = SsoAuthManager.signInWithGitHub.bind(SsoAuthManager);
export const signInWithGoogle = SsoAuthManager.signInWithGoogle.bind(SsoAuthManager);
export const signInWithMicrosoft = SsoAuthManager.signInWithMicrosoft.bind(SsoAuthManager);
export const signInWithApple = SsoAuthManager.signInWithApple.bind(SsoAuthManager);
export const getProviderDisplayName = SsoAuthManager.getProviderDisplayName;
export const getProviderIconName = SsoAuthManager.getProviderIconName;
export const isProviderAvailable = SsoAuthManager.isProviderAvailable;
export const validateAuthState = SsoAuthManager.validateAuthState;