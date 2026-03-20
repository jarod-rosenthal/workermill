import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { API_BASE_URL } from '@/constants/config';

interface SsoConfig {
  providers: { name: string; displayName: string }[];
  clientId: string;
  hostedUiBaseUrl: string;
}

interface SsoAuthResult {
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

export async function getSsoConfig(): Promise<SsoConfig> {
  const res = await fetch(`${API_BASE_URL}/auth/sso-config`);
  if (!res.ok) {
    throw new Error('Failed to fetch SSO configuration');
  }
  return res.json();
}

export async function signInWithProvider(
  providerName: string,
  ssoConfig: SsoConfig,
): Promise<SsoAuthResult> {
  const state = `mobile_${Crypto.randomUUID()}`;

  let authorizeUrl: string;
  let callbackEndpoint: string;

  if (providerName === "GitHub") {
    // GitHub uses direct OAuth, not Cognito Hosted UI
    const res = await fetch(`${API_BASE_URL}/auth/github/authorize`);
    if (!res.ok) {
      throw new Error('Failed to get GitHub authorize URL');
    }
    const { authorizeUrl: ghUrl, state: ghState } = await res.json();
    authorizeUrl = ghUrl.replace(`state=${ghState}`, `state=mobile_${ghState}`);
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
    throw new Error('Sign-in was cancelled');
  }

  // Extract code from redirect URL
  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('No authorization code received');

  // Exchange code for tokens
  const tokenRes = await fetch(callbackEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirectUri: providerName === "GitHub"
        ? "https://workermill.com/auth/github/callback"
        : "https://workermill.com/auth/callback",
    }),
  });

  if (!tokenRes.ok) {
    const errorData = await tokenRes.text();
    throw new Error(`Authentication failed: ${tokenRes.status} - ${errorData}`);
  }

  return tokenRes.json();
}

export async function signInWithEmail(
  email: string,
  password: string,
  mfaCode?: string
): Promise<SsoAuthResult> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      ...(mfaCode && { mfaCode }),
    }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || 'Login failed');
  }

  return res.json();
}