import React from 'react';
import { View } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <View
      className={`
        bg-white dark:bg-slate-850
        border border-slate-200 dark:border-slate-700
        rounded-lg shadow-sm p-4
        ${className || ''}
      `}
    >
      {children}
    </View>
  );
}