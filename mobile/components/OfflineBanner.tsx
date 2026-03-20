import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface OfflineBannerProps {
  visible: boolean;
  message?: string;
  className?: string;
}

export function OfflineBanner({
  visible,
  message = 'Offline — reconnecting...',
  className
}: OfflineBannerProps) {
  if (!visible) {
    return null;
  }

  return (
    <View
      className={`
        bg-amber-500 px-4 py-3 flex-row items-center
        ${className || ''}
      `}
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <MaterialIcons
        name="wifi-off"
        size={16}
        color="#ffffff"
        className="mr-2"
        accessibilityHidden={true}
      />
      <Text className="text-white text-sm font-medium flex-1">
        {message}
      </Text>
    </View>
  );
}