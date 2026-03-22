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

  const Container = onReconnect ? TouchableOpacity : View;
  const containerProps = onReconnect ? { onPress: onReconnect, activeOpacity: 0.7 } : {};

  return (
    <Container
      {...containerProps}
      className={`bg-amber-500 px-4 py-3 flex-row items-center ${className || ''}`}
      accessibilityRole={onReconnect ? 'button' : 'alert'}
      accessibilityLabel={onReconnect ? `${message}. Tap to reconnect.` : message}
      style={onReconnect ? { minHeight: 44 } : undefined}
    >
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
    </Container>
  );
}
