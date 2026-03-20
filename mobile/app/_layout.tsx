import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';

import { useAuthStore } from '@/stores/auth-store';
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

function useProtectedRoute(user: any) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      // User not authenticated and not in auth screens, redirect to sign-in
      router.replace('/(auth)/sign-in');
    } else if (user && inAuthGroup) {
      // User authenticated but still in auth screens, redirect to main app
      router.replace('/(tabs)');
    }
  }, [user, segments]);
}

export default function RootLayout() {
  const {
    isLoading,
    user,
    checkAuthState,
    shouldShowBiometric
  } = useAuthStore();
  const [isInitialized, setIsInitialized] = useState(false);
  const router = useRouter();

  // Handle protected routes
  useProtectedRoute(user);

  // Initialize auth state and handle deep linking
  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        // Check existing auth state
        const hasValidTokens = await checkAuthState();

        if (isMounted) {
          setIsInitialized(true);

          // Hide splash screen after initialization
          await SplashScreen.hideAsync();

          // Handle initial routing based on auth state
          if (hasValidTokens && shouldShowBiometric) {
            // User has tokens and should show biometric unlock
            router.replace('/(auth)/biometric');
          } else if (hasValidTokens) {
            // User has tokens but biometric failed too many times, go to main app
            router.replace('/(tabs)');
          } else {
            // No valid tokens, show sign-in
            router.replace('/(auth)/sign-in');
          }
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
        if (isMounted) {
          setIsInitialized(true);
          await SplashScreen.hideAsync();
          router.replace('/(auth)/sign-in');
        }
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
  }, []);

  // Handle notification response (when user taps notification)
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;

      // Handle deep linking from notifications
      if (data?.taskId) {
        router.push(`/task/${data.taskId}`);
      } else if (data?.boardId && data?.cardId) {
        router.push(`/board/${data.boardId}/card/${data.cardId}`);
      } else if (data?.boardId) {
        router.push(`/board/${data.boardId}`);
      }
    });

    return () => subscription.remove();
  }, [router]);

  // Show loading screen until initialization completes
  if (!isInitialized || isLoading) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#0f172a' }} />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="task"
          options={{
            headerShown: false,
            presentation: 'card',
          }}
        />
        <Stack.Screen
          name="board"
          options={{
            headerShown: false,
            presentation: 'card',
          }}
        />
      </Stack>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}