import React from 'react';
import { ActivityIndicator, View, ViewStyle } from 'react-native';

interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
  style?: ViewStyle;
}

export function Spinner({ size = 'large', color = '#6366f1', style }: SpinnerProps) {
  return (
    <View
      className="flex-1 justify-center items-center"
      style={style}
    >
      <ActivityIndicator size={size} color={color} />
    </View>
  );
}