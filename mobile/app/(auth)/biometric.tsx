import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth-store';
import { BiometricAuth, getBiometricTypeName } from '@/lib/biometric';

export default function BiometricScreen() {
  const [biometricTypeName, setBiometricTypeName] = useState('Biometric authentication');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [canRetry, setCanRetry] = useState(true);

  const {
    biometricFailCount,
    shouldShowBiometric,
    incrementBiometricFailCount,
    refreshUserProfile,
    checkAuthStatus,
  } = useAuthStore();

  const initializeBiometric = useCallback(async () => {
    try {
      const typeName = await getBiometricTypeName();
      setBiometricTypeName(typeName);
    } catch (error) {
      console.error('Failed to initialize biometric:', error);
      // Fall back to sign-in screen if biometric setup fails
      router.replace('/(auth)/sign-in');
    }
  }, []);

  useEffect(() => {
    initializeBiometric();
  }, [initializeBiometric]);

  useEffect(() => {
    // If user has reached fail limit, redirect to sign-in
    if (!shouldShowBiometric || biometricFailCount >= 3) {
      router.replace('/(auth)/sign-in');
    }
  }, [shouldShowBiometric, biometricFailCount]);

  const promptBiometric = useCallback(async () => {
    if (!canRetry || isAuthenticating) {
      return;
    }

    setIsAuthenticating(true);

    try {
      const result = await BiometricAuth.authenticate({
        promptMessage: `Use ${biometricTypeName} to unlock WorkerMill`,
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Sign In',
      });

      if (result.success) {
        // Biometric auth successful - validate stored tokens and navigate
        try {
          await checkAuthStatus();
          await refreshUserProfile();
          router.replace('/(tabs)');
        } catch {
          // Stored tokens might be invalid - redirect to sign-in
          router.replace('/(auth)/sign-in');
        }
      } else {
        // Biometric auth failed
        if (result.errorCode === 'USER_CANCEL' || result.errorCode === 'USER_FALLBACK') {
          // User cancelled or chose fallback - go to sign-in
          router.replace('/(auth)/sign-in');
        } else if (result.errorCode === 'AUTH_FAILED') {
          // Authentication failed - increment fail count
          await incrementBiometricFailCount();

          const newFailCount = biometricFailCount + 1;
          if (newFailCount >= 3) {
            Alert.alert(
              'Too Many Attempts',
              'Please sign in with your email and password.',
              [
                {
                  text: 'OK',
                  onPress: () => router.replace('/(auth)/sign-in'),
                },
              ]
            );
          } else {
            const remainingAttempts = 3 - newFailCount;
            Alert.alert(
              'Authentication Failed',
              `${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before requiring password sign-in.`,
              [
                {
                  text: 'Try Again',
                  onPress: () => setCanRetry(true),
                },
                {
                  text: 'Use Password',
                  onPress: () => router.replace('/(auth)/sign-in'),
                  style: 'cancel',
                },
              ]
            );
            setCanRetry(false);
          }
        } else if (result.errorCode === 'TOO_MANY_ATTEMPTS') {
          Alert.alert(
            'Biometric Locked',
            'Too many failed attempts. Please try again later or sign in with your password.',
            [
              {
                text: 'Use Password',
                onPress: () => router.replace('/(auth)/sign-in'),
              },
            ]
          );
        } else {
          // Other errors - show generic message
          Alert.alert(
            'Authentication Error',
            result.error || 'An error occurred during authentication. Please try signing in with your password.',
            [
              {
                text: 'Use Password',
                onPress: () => router.replace('/(auth)/sign-in'),
              },
            ]
          );
        }
      }
    } catch (error) {
      console.error('Biometric authentication error:', error);
      Alert.alert(
        'Error',
        'An unexpected error occurred. Please sign in with your password.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(auth)/sign-in'),
          },
        ]
      );
    } finally {
      setIsAuthenticating(false);
    }
  }, [biometricTypeName, canRetry, isAuthenticating, biometricFailCount, incrementBiometricFailCount, checkAuthStatus, refreshUserProfile]);

  useEffect(() => {
    // Auto-prompt for biometric auth after initialization (with slight delay for better UX)
    if (biometricTypeName !== 'Biometric authentication') {
      const timer = setTimeout(() => {
        promptBiometric();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [biometricTypeName, promptBiometric]);

  const getBiometricIcon = () => {
    if (biometricTypeName.includes('Face ID')) {
      return 'scan';
    } else if (biometricTypeName.includes('Touch ID') || biometricTypeName.includes('fingerprint')) {
      return 'finger-print';
    }
    return 'lock-closed';
  };

  const getFailCountMessage = () => {
    if (biometricFailCount === 0) {
      return null;
    }

    const remaining = 3 - biometricFailCount;
    if (remaining > 0) {
      return `${remaining} attempt${remaining === 1 ? '' : 's'} remaining`;
    }

    return 'Maximum attempts reached';
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-slate-950">
      <View className="flex-1 justify-center items-center px-6">
        {/* Biometric Icon */}
        <View className="w-24 h-24 bg-brand-100 dark:bg-brand-900 rounded-full justify-center items-center mb-8">
          <Ionicons
            name={getBiometricIcon()}
            size={48}
            color="#6366f1"
          />
        </View>

        {/* Title and Description */}
        <Text className="text-2xl font-bold text-slate-900 dark:text-white text-center mb-2">
          Unlock WorkerMill
        </Text>
        <Text className="text-center text-slate-600 dark:text-slate-400 mb-8">
          Use {biometricTypeName} to quickly access your account
        </Text>

        {/* Fail Count Warning */}
        {getFailCountMessage() && (
          <View className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-6">
            <Text className="text-sm text-amber-600 dark:text-amber-400 text-center">
              {getFailCountMessage()}
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View className="w-full space-y-3">
          <Button
            onPress={promptBiometric}
            loading={isAuthenticating}
            disabled={isAuthenticating || !canRetry}
            className="w-full"
          >
            {isAuthenticating ? 'Authenticating...' : `Use ${biometricTypeName}`}
          </Button>

          <Button
            variant="outline"
            onPress={() => router.replace('/(auth)/sign-in')}
            disabled={isAuthenticating}
            className="w-full"
          >
            Use Email & Password
          </Button>
        </View>

        {/* Footer */}
        <Text className="text-xs text-slate-500 dark:text-slate-400 text-center mt-12">
          After 3 failed attempts, you'll need to sign in with your password
        </Text>
      </View>
    </SafeAreaView>
  );
}