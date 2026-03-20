import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface OfflineBannerProps {
  message?: string;
}

export function OfflineBanner({ message = 'Offline — reconnecting...' }: OfflineBannerProps) {
  return (
    <View className="bg-amber-500 px-4 py-3 flex-row items-center">
      <Ionicons name="warning-outline" size={20} color="white" className="mr-2" />
      <Text className="text-white font-medium flex-1">
        {message}
      </Text>
    </View>
  );
}