import React from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function SettingsScreen() {
  return (
    <View className="flex-1 bg-slate-950 items-center justify-center">
      <StatusBar style="light" />
      <Text className="text-white text-xl">Settings</Text>
      <Text className="text-slate-400 text-center mt-2">
        Coming soon - will show profile, organization, and notification settings
      </Text>
    </View>
  );
}