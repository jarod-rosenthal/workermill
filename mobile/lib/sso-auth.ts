import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { API_BASE_URL } from '@/constants/config';

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

export class SsoAuthManager {
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
        authorizeUrl = ghUrl.replace(`state=${ghState}`, `state=${state}`);
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
          `&state=${state}`;
        callbackEndpoint = `${API_BASE_URL}/auth/sso-callback`;
      }

      // Open browser and wait for workermill:// redirect
      const result = await WebBrowser.openAuthSessionAsync(
        authorizeUrl,
        'workermill://auth/callback'
      );

      if (result.type !== 'success') {
        return {
          success: false,
          cancelled: result.type === 'cancel',
          error: result.type === 'cancel' ? 'Sign-in was cancelled' : 'Authentication failed',
        };
      }

      // Extract code from redirect URL
      const url = new URL(result.url);
      const code = url.searchParams.get('code');

      if (!code) {
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
          redirectUri: providerName === "GitHub"
            ? "https://workermill.com/auth/github/callback"
            : "https://workermill.com/auth/callback",
        }),
      });

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
}

// Export convenience functions for common usage patterns
export const getSsoConfig = SsoAuthManager.getSsoConfig;
export const signInWithProvider = SsoAuthManager.signInWithProvider;
export const signInWithGitHub = SsoAuthManager.signInWithGitHub;
export const signInWithGoogle = SsoAuthManager.signInWithGoogle;
export const signInWithMicrosoft = SsoAuthManager.signInWithMicrosoft;
export const signInWithApple = SsoAuthManager.signInWithApple;
export const getProviderDisplayName = SsoAuthManager.getProviderDisplayName;
export const getProviderIconName = SsoAuthManager.getProviderIconName;
export const isProviderAvailable = SsoAuthManager.isProviderAvailable;