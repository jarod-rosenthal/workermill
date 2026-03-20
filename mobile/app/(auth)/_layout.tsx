import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card',
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="sign-in"
        options={{
          title: 'Sign In',
          gestureEnabled: false, // Prevent swipe back on sign-in screen
        }}
      />
      <Stack.Screen
        name="biometric"
        options={{
          title: 'Unlock',
          gestureEnabled: false, // Prevent swipe back on biometric unlock
        }}
      />
    </Stack>
  );
}