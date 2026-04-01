import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface OfflineBannerProps {
  visible: boolean;
  message?: string;
  onReconnect?: () => void;
  className?: string;
}

export function OfflineBanner({
  visible,
  message = 'Offline — reconnecting...',
  onReconnect,
  className
}: OfflineBannerProps) {
  if (!visible) {
    return null;
  }

  const sharedProps = {
    className: `bg-amber-500 px-4 py-3 flex-row items-center ${className || ''}`,
    accessibilityLabel: onReconnect ? `${message}. Tap to reconnect.` : message,
  };

  const content = (
    <>
      <MaterialIcons
        name="wifi-off"
        size={16}
        color="#ffffff"
        style={{ marginRight: 8 }}
        accessibilityHidden={true}
      />
      <Text className="text-white text-sm font-medium flex-1">
        {message}
      </Text>
      {onReconnect && (
        <Text className="text-white text-xs font-medium opacity-80">
          Tap to retry
        </Text>
      )}
    </>
  );

  if (onReconnect) {
    return (
      <TouchableOpacity
        {...sharedProps}
        onPress={onReconnect}
        activeOpacity={0.7}
        accessibilityRole="button"
        style={{ minHeight: 44 }}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View {...sharedProps} accessibilityRole="alert">
      {content}
    </View>
  );
}
