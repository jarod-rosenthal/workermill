import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '@/stores/auth-store';
import { useNotificationsStore } from '@/stores/notifications-store';
import { handleNotificationData } from '@/lib/deep-linking';
import '../global.css';

// Prevent the splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Configure notification handling
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function useProtectedRoute(isAppReady: boolean) {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading, shouldShowBiometric } = useAuthStore();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // Wait one tick after mount so the navigator (Slot/Stack) is ready
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !isAppReady || isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated) {
      if (!inAuthGroup) {
        router.replace('/(auth)/sign-in');
      }
    } else {
      if (inAuthGroup) {
        if (shouldShowBiometric) {
          router.replace('/(auth)/biometric');
        } else {
          router.replace('/(tabs)');
        }
      }
    }
  }, [isAuthenticated, isLoading, shouldShowBiometric, segments, router, isMounted, isAppReady]);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [isAppReady, setIsAppReady] = useState(false);
  const { checkAuthStatus, loadBiometricSettings, isLoading } = useAuthStore();
  const { loadPreferences } = useNotificationsStore();

  useProtectedRoute(isAppReady);

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Load auth state and biometric settings
        await Promise.all([
          loadBiometricSettings(),
          checkAuthStatus()
        ]);

        // Load notification preferences if authenticated
        // (will fail gracefully if not authenticated)
        try {
          await loadPreferences();
        } catch (error) {
          console.warn('Failed to load notification preferences:', error);
        }
      } catch (error) {
        console.error('App initialization error:', error);
      } finally {
        setIsAppReady(true);
        await SplashScreen.hideAsync();
      }
    };

    initializeApp();
  }, [checkAuthStatus, loadBiometricSettings, loadPreferences]);

  // Set up notification listeners
  useEffect(() => {
    // Handle notification when app is foregrounded
    const foregroundSubscription = Notifications.addNotificationReceivedListener(
      notification => {
        console.log('Notification received in foreground:', notification);
      }
    );

    // Handle notification response (when user taps notification)
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      response => {
        const notificationData = response.notification.request.content.data;
        handleNotificationData(notificationData);
      }
    );

    return () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  if (!isAppReady || isLoading) {
    // Show loading screen while initializing
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center">
        <Text className="text-white text-lg">Loading...</Text>
      </View>
    );
  }

  return children;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="task"
            options={{
              headerShown: false,
              presentation: 'card'
            }}
          />
          <Stack.Screen
            name="board"
            options={{
              headerShown: false,
              presentation: 'card'
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </AuthGate>
    </SafeAreaProvider>
  );
}