import React from 'react';
import { View, Text } from 'react-native';

interface BadgeProps {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
  className?: string;
}

const variants = {
  default: 'bg-slate-100 dark:bg-slate-800',
  primary: 'bg-brand-100 dark:bg-brand-900',
  secondary: 'bg-purple-100 dark:bg-purple-900',
  success: 'bg-green-100 dark:bg-green-900',
  warning: 'bg-yellow-100 dark:bg-yellow-900',
  error: 'bg-red-100 dark:bg-red-900',
};

const textColors = {
  default: 'text-slate-800 dark:text-slate-200',
  primary: 'text-brand-800 dark:text-brand-200',
  secondary: 'text-purple-800 dark:text-purple-200',
  success: 'text-green-800 dark:text-green-200',
  warning: 'text-yellow-800 dark:text-yellow-200',
  error: 'text-red-800 dark:text-red-200',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <View
      className={`px-2 py-1 rounded-full ${variants[variant]} ${className || ''}`}
      accessibilityRole="text"
    >
      <Text
        className={`text-xs font-medium ${textColors[variant]}`}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}