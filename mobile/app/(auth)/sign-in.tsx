import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '@/stores/auth-store';
import { getSsoConfig, signInWithProvider, signInWithEmail } from '@/lib/sso-auth';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';

interface SsoProvider {
  name: string;
  displayName: string;
  icon: string; // Emoji or icon name
  color: string; // Button color
}

const SSO_PROVIDER_CONFIG: Record<string, SsoProvider> = {
  GitHub: {
    name: 'GitHub',
    displayName: 'GitHub',
    icon: '🐙',
    color: 'bg-slate-800',
  },
  Google: {
    name: 'Google',
    displayName: 'Google',
    icon: '🟡',
    color: 'bg-blue-600',
  },
  Microsoft: {
    name: 'Microsoft',
    displayName: 'Microsoft',
    icon: '🔷',
    color: 'bg-blue-500',
  },
  Apple: {
    name: 'Apple',
    displayName: 'Apple',
    icon: '🍎',
    color: 'bg-slate-900',
  },
  Facebook: {
    name: 'Facebook',
    displayName: 'Facebook',
    icon: '📘',
    color: 'bg-blue-700',
  },
};

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, setLoading, isLoading } = useAuthStore();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showMfaInput, setShowMfaInput] = useState(false);

  // SSO state
  const [ssoConfig, setSsoConfig] = useState<any>(null);
  const [loadingSsoConfig, setLoadingSsoConfig] = useState(true);
  const [availableProviders, setAvailableProviders] = useState<SsoProvider[]>([]);

  // Loading states for individual SSO providers
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  // Load SSO configuration on mount
  useEffect(() => {
    loadSsoConfig();
  }, []);

  const loadSsoConfig = async () => {
    try {
      const config = await getSsoConfig();
      setSsoConfig(config);

      // Map configured providers to UI config
      const providers = config.providers
        .map((p: any) => SSO_PROVIDER_CONFIG[p.name])
        .filter(Boolean);

      setAvailableProviders(providers);
    } catch (error) {
      console.warn('Failed to load SSO config:', error);
      // Continue without SSO options
    } finally {
      setLoadingSsoConfig(false);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter your email and password');
      return;
    }

    try {
      setLoading(true);
      const result = await signInWithEmail(email, password, mfaCode || undefined);

      // Sign in successful
      await signIn(
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          idToken: result.idToken,
        },
        result.user
      );

      // Navigate to main app
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Email sign-in failed:', error);

      // Check if MFA is required
      if (error.message?.includes('MFA') || error.message?.includes('TOTP')) {
        setShowMfaInput(true);
        Alert.alert('MFA Required', 'Please enter your MFA code to continue');
        return;
      }

      Alert.alert('Sign In Failed', error.message || 'Please check your credentials and try again');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoSignIn = async (provider: SsoProvider) => {
    if (!ssoConfig) {
      Alert.alert('Error', 'SSO configuration not available');
      return;
    }

    try {
      setLoadingProvider(provider.name);
      const result = await signInWithProvider(provider.name, ssoConfig);

      // Sign in successful
      await signIn(
        {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          idToken: result.idToken,
        },
        result.user
      );

      // Navigate to main app
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(`${provider.name} sign-in failed:`, error);

      if (error.message?.includes('cancelled')) {
        // User cancelled - no need to show error
        return;
      }

      Alert.alert(
        'Sign In Failed',
        `Failed to sign in with ${provider.displayName}. Please try again.`
      );
    } finally {
      setLoadingProvider(null);
    }
  };

  if (loadingSsoConfig) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <Spinner />
        <Text className="text-white mt-4">Loading...</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <StatusBar style="light" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 px-6 pt-20 pb-8">
          {/* Logo and title */}
          <View className="items-center mb-12">
            <View className="w-20 h-20 bg-brand-600 rounded-2xl items-center justify-center mb-6">
              <Text className="text-3xl font-bold text-white">WM</Text>
            </View>
            <Text className="text-3xl font-bold text-white mb-2">WorkerMill</Text>
            <Text className="text-slate-400 text-center text-base">
              Sign in to monitor your AI workers
            </Text>
          </View>

          {/* SSO Buttons */}
          {availableProviders.length > 0 && (
            <View className="mb-8">
              <Text className="text-slate-400 text-sm mb-4 text-center">
                Continue with
              </Text>

              <View className="space-y-3">
                {availableProviders.map((provider) => (
                  <TouchableOpacity
                    key={provider.name}
                    onPress={() => handleSsoSignIn(provider)}
                    disabled={loadingProvider !== null || isLoading}
                    className={`${provider.color} ${
                      loadingProvider === provider.name || isLoading
                        ? 'opacity-50'
                        : 'opacity-100'
                    } p-4 rounded-xl flex-row items-center justify-center`}
                    style={{ minHeight: 48 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Sign in with ${provider.displayName}`}
                  >
                    {loadingProvider === provider.name ? (
                      <View className="w-5 h-5 mr-3">
                        <Spinner />
                      </View>
                    ) : (
                      <Text className="text-xl mr-3">{provider.icon}</Text>
                    )}
                    <Text className="text-white font-semibold text-base">
                      Continue with {provider.displayName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Divider */}
          <View className="flex-row items-center mb-8">
            <View className="flex-1 h-px bg-slate-700" />
            <Text className="text-slate-400 px-4 text-sm">or</Text>
            <View className="flex-1 h-px bg-slate-700" />
          </View>

          {/* Email/Password Form */}
          <View className="space-y-4">
            <View>
              <Text className="text-slate-300 text-sm font-medium mb-2">Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor="#64748b"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                className="bg-slate-800 text-white p-4 rounded-xl text-base"
                editable={!isLoading && !loadingProvider}
              />
            </View>

            <View>
              <Text className="text-slate-300 text-sm font-medium mb-2">Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#64748b"
                secureTextEntry
                autoComplete="current-password"
                className="bg-slate-800 text-white p-4 rounded-xl text-base"
                editable={!isLoading && !loadingProvider}
              />
            </View>

            {showMfaInput && (
              <View>
                <Text className="text-slate-300 text-sm font-medium mb-2">
                  MFA Code
                </Text>
                <TextInput
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  placeholder="Enter your 6-digit code"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="bg-slate-800 text-white p-4 rounded-xl text-base text-center tracking-widest"
                  editable={!isLoading && !loadingProvider}
                />
              </View>
            )}

            <Button
              variant="primary"
              onPress={handleEmailSignIn}
              disabled={isLoading || loadingProvider !== null}
              loading={isLoading}
              style={{ marginTop: 24 }}
            >
              {showMfaInput ? 'Verify & Sign In' : 'Sign In'}
            </Button>
          </View>

          {/* Reset MFA form */}
          {showMfaInput && (
            <TouchableOpacity
              onPress={() => {
                setShowMfaInput(false);
                setMfaCode('');
              }}
              className="mt-4 items-center"
              disabled={isLoading}
            >
              <Text className="text-brand-400 text-sm">
                Back to password sign-in
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}