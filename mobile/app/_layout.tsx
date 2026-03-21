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
  // Use selectors to avoid re-renders from unrelated store changes
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const shouldShowBiometric = useAuthStore((s) => s.shouldShowBiometric);
  const lastNavTarget = React.useRef<string | null>(null);

  useEffect(() => {
    if (!isAppReady || isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    let target: string | null = null;

    if (!isAuthenticated && !inAuthGroup) {
      target = '/(auth)/sign-in';
    } else if (isAuthenticated && inAuthGroup) {
      target = shouldShowBiometric ? '/(auth)/biometric' : '/(tabs)';
    }

    // Only navigate if target changed (prevents re-render loops)
    if (target && target !== lastNavTarget.current) {
      lastNavTarget.current = target;
      setTimeout(() => router.replace(target as any), 0);
    }
  }, [isAuthenticated, isLoading, shouldShowBiometric, segments, isAppReady]);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [isAppReady, setIsAppReady] = useState(false);
  const isLoading = useAuthStore((s) => s.isLoading);

  useProtectedRoute(isAppReady);

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Load auth state and biometric settings
        const store = useAuthStore.getState();
        await Promise.all([
          store.loadBiometricSettings(),
          store.checkAuthStatus()
        ]);

        // Load notification preferences if authenticated
        // (will fail gracefully if not authenticated)
        try {
          await useNotificationsStore.getState().loadPreferences();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

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
            name="task/[id]"
            options={{
              headerShown: false,
              presentation: 'card'
            }}
          />
          <Stack.Screen
            name="board/[id]"
            options={{
              headerShown: false,
              presentation: 'card'
            }}
          />
          <Stack.Screen
            name="board/[id]/card/[cardId]"
            options={{
              headerShown: false,
              presentation: 'modal'
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </AuthGate>
    </SafeAreaProvider>
  );
}