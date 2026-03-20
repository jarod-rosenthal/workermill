import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  BackHandler,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '@/stores/auth-store';
import {
  authenticateWithBiometric,
  checkBiometricAvailability,
  getBiometricTypeName,
} from '@/lib/biometric';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export default function BiometricScreen() {
  const router = useRouter();
  const {
    user,
    recordBiometricFailure,
    resetBiometricAttempts,
    biometricFailedAttempts,
    signOut,
  } = useAuthStore();

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricTypeName, setBiometricTypeName] = useState('Biometric');
  const [isLoading, setIsLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  // Initialize biometric info
  useEffect(() => {
    initializeBiometric();
  }, []);

  // Disable hardware back button on Android
  useEffect(() => {
    const backAction = () => {
      // Don't allow back navigation from biometric screen
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);

    return () => backHandler.remove();
  }, []);

  // Auto-prompt biometric on load
  useEffect(() => {
    if (biometricAvailable && !isLoading) {
      // Auto-prompt after a brief delay to ensure UI is ready
      const timer = setTimeout(() => {
        handleBiometricAuth();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [biometricAvailable, isLoading]);

  const initializeBiometric = async () => {
    try {
      const biometricInfo = await checkBiometricAvailability();

      if (biometricInfo.isAvailable && biometricInfo.hasEnrolledCredentials) {
        setBiometricAvailable(true);
        const typeName = getBiometricTypeName(biometricInfo.supportedTypes);
        setBiometricTypeName(typeName);
      } else {
        // If biometric isn't available, proceed to main app
        router.replace('/(tabs)');
        return;
      }
    } catch (error) {
      console.error('Failed to initialize biometric:', error);
      // Proceed to main app if there's an error
      router.replace('/(tabs)');
      return;
    }

    setIsLoading(false);
  };

  const handleBiometricAuth = async () => {
    if (!biometricAvailable) return;

    try {
      setIsAuthenticating(true);

      const result = await authenticateWithBiometric(
        `Use ${biometricTypeName} to unlock WorkerMill`
      );

      if (result.success) {
        // Reset attempt counter on success
        await resetBiometricAttempts();

        // Navigate to main app
        router.replace('/(tabs)');
      } else {
        // Record the failure
        await recordBiometricFailure();

        if (result.error?.includes('cancelled')) {
          // User cancelled - show options
          return;
        }

        if (result.error?.includes('lockout') || result.error?.includes('too many')) {
          // Biometric is locked out, force sign-in
          Alert.alert(
            'Biometric Locked',
            'Biometric authentication is temporarily disabled. Please sign in with your credentials.',
            [
              {
                text: 'Sign In',
                onPress: () => router.replace('/(auth)/sign-in'),
              },
            ]
          );
          return;
        }

        // Check if we've hit the 3-attempt limit
        if (biometricFailedAttempts >= 2) {
          // This will be the 3rd failure, force sign-in
          Alert.alert(
            'Too Many Failed Attempts',
            'Biometric authentication has failed too many times. Please sign in with your credentials.',
            [
              {
                text: 'Sign In',
                onPress: () => router.replace('/(auth)/sign-in'),
              },
            ]
          );
          return;
        }

        // Show error and allow retry
        Alert.alert(
          'Authentication Failed',
          result.error || 'Biometric authentication failed. Please try again.',
          [
            {
              text: 'Try Again',
              onPress: () => handleBiometricAuth(),
            },
            {
              text: 'Use Password',
              onPress: () => router.replace('/(auth)/sign-in'),
              style: 'cancel',
            },
          ]
        );
      }
    } catch (error) {
      console.error('Biometric authentication error:', error);
      Alert.alert(
        'Authentication Error',
        'An error occurred during biometric authentication. Please sign in with your credentials.',
        [
          {
            text: 'Sign In',
            onPress: () => router.replace('/(auth)/sign-in'),
          },
        ]
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleUsePassword = () => {
    router.replace('/(auth)/sign-in');
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/(auth)/sign-in');
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <Spinner />
        <Text className="text-white mt-4">Initializing...</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  const remainingAttempts = Math.max(0, 3 - biometricFailedAttempts);

  return (
    <View className="flex-1 bg-slate-950 px-6 pt-20 pb-8">
      <StatusBar style="light" />

      <View className="flex-1 items-center justify-center">
        {/* Logo */}
        <View className="w-24 h-24 bg-brand-600 rounded-3xl items-center justify-center mb-8">
          <Text className="text-4xl font-bold text-white">WM</Text>
        </View>

        {/* Welcome back message */}
        <Text className="text-2xl font-bold text-white text-center mb-2">
          Welcome back
        </Text>
        {user?.name && (
          <Text className="text-slate-400 text-lg text-center mb-8">
            {user.name}
          </Text>
        )}

        {/* Biometric icon and prompt */}
        <View className="items-center mb-12">
          <View className="w-16 h-16 bg-slate-800 rounded-2xl items-center justify-center mb-6">
            <Text className="text-3xl">
              {biometricTypeName.includes('Face') ? '🔐' : '👆'}
            </Text>
          </View>

          <Text className="text-white text-xl font-semibold text-center mb-2">
            Unlock with {biometricTypeName}
          </Text>

          <Text className="text-slate-400 text-center text-base max-w-sm">
            Use {biometricTypeName.toLowerCase()} to securely access your WorkerMill account
          </Text>

          {remainingAttempts < 3 && remainingAttempts > 0 && (
            <Text className="text-yellow-500 text-sm mt-4">
              {remainingAttempts} attempt{remainingAttempts !== 1 ? 's' : ''} remaining
            </Text>
          )}
        </View>

        {/* Action buttons */}
        <View className="w-full space-y-4">
          <Button
            variant="primary"
            size="lg"
            onPress={handleBiometricAuth}
            loading={isAuthenticating}
            disabled={!biometricAvailable || remainingAttempts === 0}
            style={{ width: '100%' }}
          >
            {isAuthenticating ? 'Authenticating...' : `Use ${biometricTypeName}`}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            onPress={handleUsePassword}
            disabled={isAuthenticating}
            style={{ width: '100%' }}
          >
            Use Password Instead
          </Button>
        </View>
      </View>

      {/* Sign out option */}
      <View className="items-center pt-8">
        <TouchableOpacity
          onPress={handleSignOut}
          disabled={isAuthenticating}
          className="p-2"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text className="text-slate-400 text-sm">
            Not {user?.name?.split(' ')[0] || 'you'}? Sign out
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}