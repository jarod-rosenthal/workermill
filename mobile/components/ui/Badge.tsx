import React from 'react';
import { View, Text } from 'react-native';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

const variants = {
  default: 'bg-slate-500 text-white',
  success: 'bg-green-500 text-white',
  warning: 'bg-yellow-400 text-slate-900',
  error: 'bg-red-500 text-white',
  info: 'bg-blue-600 text-white',
};

const sizes = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
};

export function Badge({ variant = 'default', size = 'md', children }: BadgeProps) {
  return (
    <View className={`rounded-full ${variants[variant]} ${sizes[size]}`}>
      <Text className={`font-medium text-center ${variant === 'warning' ? 'text-slate-900' : 'text-white'}`}>
        {children}
      </Text>
    </View>
  );
}