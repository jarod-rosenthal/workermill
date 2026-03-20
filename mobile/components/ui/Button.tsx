import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
  className?: string;
}

const variants = {
  primary: 'bg-brand-600 active:bg-brand-700',
  secondary: 'bg-slate-600 active:bg-slate-700',
  outline: 'border border-brand-600 bg-transparent active:bg-brand-50 dark:active:bg-brand-950',
  ghost: 'bg-transparent active:bg-slate-100 dark:active:bg-slate-800',
};

const textColors = {
  primary: 'text-white',
  secondary: 'text-white',
  outline: 'text-brand-600 dark:text-brand-400',
  ghost: 'text-slate-900 dark:text-slate-100',
};

const sizes = {
  sm: 'px-3 py-2 min-h-[44]',
  md: 'px-4 py-3 min-h-[48]',
  lg: 'px-6 py-4 min-h-[52]',
};

const textSizes = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  onPress,
  children,
  className
}: ButtonProps) {
  const isDisabled = loading || disabled;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      className={`
        rounded-lg justify-center items-center flex-row
        ${variants[variant]}
        ${sizes[size]}
        ${isDisabled ? 'opacity-50' : ''}
        ${className || ''}
      `}
      style={{ minWidth: 48, minHeight: size === 'sm' ? 44 : size === 'md' ? 48 : 52 }}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'secondary' ? '#ffffff' : '#6366f1'}
          className="mr-2"
        />
      ) : null}
      <Text
        className={`font-medium ${textColors[variant]} ${textSizes[size]}`}
        numberOfLines={1}
      >
        {children}
      </Text>
    </TouchableOpacity>
  );
}