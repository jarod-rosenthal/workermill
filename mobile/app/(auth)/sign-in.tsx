import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth-store';
import { registerPushToken } from '@/lib/push';
import { getSsoConfig, signInWithProvider, type SsoConfig, getProviderIconName } from '@/lib/sso-auth';

interface SsoProvider {
  name: string;
  displayName: string;
  iconName: string;
}

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([]);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

  const { signIn, signInWithSSO, isLoading, error, setError } = useAuthStore();

  // Load SSO configuration on mount
  useEffect(() => {
    loadSsoConfig();
  }, []);

  const loadSsoConfig = async () => {
    try {
      const config = await getSsoConfig();
      setSsoConfig(config);

      // Transform providers for UI
      const providers = config.providers.map(provider => ({
        name: provider.name,
        displayName: provider.displayName,
        iconName: getProviderIconName(provider.name),
      }));
      setSsoProviders(providers);
    } catch (error) {
      console.error('Failed to load SSO config:', error);
      // Continue without SSO - email/password will still work
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password');
      return;
    }

    try {
      await signIn(email.trim(), password);

      // Register push token after successful sign-in
      registerPushToken();

      // Navigate to main app
      router.replace('/(tabs)');
    } catch (error: any) {
      // Error is handled by the auth store
      if (error.response?.data?.requiresMfa) {
        // TODO: Navigate to MFA challenge screen when implemented
        Alert.alert('MFA Required', 'Multi-factor authentication is not yet supported in the mobile app.');
      }
    }
  };

  const handleSsoSignIn = async (providerName: string) => {
    if (!ssoConfig) {
      Alert.alert('Error', 'SSO configuration not loaded. Please try again.');
      return;
    }

    setSsoLoading(providerName);

    try {
      const result = await signInWithProvider(providerName, ssoConfig);

      if (result.success && result.data) {
        await signInWithSSO(
          {
            accessToken: result.data.accessToken,
            refreshToken: result.data.refreshToken,
            idToken: result.data.idToken,
          },
          result.data.user
        );

        // Register push token after successful sign-in
        registerPushToken();

        // Navigate to main app
        router.replace('/(tabs)');
      } else {
        if (!result.cancelled) {
          Alert.alert(
            'Sign In Failed',
            result.error || 'An error occurred during sign-in'
          );
        }
      }
    } catch (error: any) {
      Alert.alert(
        'Sign In Error',
        error.message || 'An unexpected error occurred'
      );
    } finally {
      setSsoLoading(null);
    }
  };

  const getSsoButtonVariant = (providerName: string) => {
    switch (providerName) {
      case 'GitHub':
        return 'secondary';
      case 'Google':
        return 'outline';
      case 'Microsoft':
        return 'outline';
      case 'Apple':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-1 justify-center px-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="mb-8">
            <Text className="text-3xl font-bold text-center text-slate-900 dark:text-white mb-2">
              Welcome to WorkerMill
            </Text>
            <Text className="text-center text-slate-600 dark:text-slate-400">
              Sign in to monitor and manage your AI workers
            </Text>
          </View>

          {/* SSO Buttons */}
          {ssoProviders.length > 0 && (
            <View className="mb-6 space-y-3">
              {ssoProviders.map((provider) => (
                <Button
                  key={provider.name}
                  variant={getSsoButtonVariant(provider.name)}
                  onPress={() => handleSsoSignIn(provider.name)}
                  loading={ssoLoading === provider.name}
                  disabled={!!ssoLoading}
                  className="w-full"
                >
                  <View className="flex-row items-center">
                    <Ionicons
                      name={provider.iconName as any}
                      size={20}
                      color={getSsoButtonVariant(provider.name) === 'outline' ? '#6366f1' : '#ffffff'}
                      style={{ marginRight: 8 }}
                    />
                    <Text>Continue with {provider.displayName}</Text>
                  </View>
                </Button>
              ))}

              <View className="flex-row items-center my-6">
                <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                <Text className="mx-4 text-sm text-slate-500 dark:text-slate-400">
                  or
                </Text>
                <View className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              </View>
            </View>
          )}

          {/* Email/Password Form */}
          <View className="space-y-4">
            <View>
              <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                style={{ minHeight: 48 }}
                accessibilityLabel="Email address"
                accessibilityRole="none"
              />
            </View>

            <View>
              <Text className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Password
              </Text>
              <View className="relative">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  autoCorrect={false}
                  className="w-full px-4 py-3 pr-12 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  style={{ minHeight: 48 }}
                  accessibilityLabel="Password"
                  accessibilityRole="none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1 w-10 h-10"
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color="#6b7280"
                  />
                </Button>
              </View>
            </View>

            {error && (
              <View className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <Text className="text-sm text-red-600 dark:text-red-400 text-center">
                  {error}
                </Text>
              </View>
            )}

            <Button
              onPress={handleEmailSignIn}
              loading={isLoading}
              disabled={isLoading || !!ssoLoading}
              className="w-full mt-6"
            >
              Sign In
            </Button>
          </View>

          <Text className="text-xs text-slate-500 dark:text-slate-400 text-center mt-8">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}