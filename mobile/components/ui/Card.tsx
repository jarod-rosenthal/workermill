import React from 'react';
import { View, ViewStyle } from 'react-native';

interface CardProps {
  className?: string;
  style?: ViewStyle;
  children: React.ReactNode;
}

export function Card({ className = '', style, children }: CardProps) {
  return (
    <View
      className={`rounded-lg border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 p-4 shadow-sm ${className}`}
      style={style}
    >
      {children}
    </View>
  );
}