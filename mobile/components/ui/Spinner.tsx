import React from 'react';
import { ActivityIndicator, View } from 'react-native';

interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
  className?: string;
}

export function Spinner({ size = 'large', color = '#6366f1', className }: SpinnerProps) {
  return (
    <View
      className={`justify-center items-center ${className || ''}`}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <ActivityIndicator size={size} color={color} />
    </View>
  );
}