import React from 'react';
import { TouchableOpacity, Text, ViewStyle, ActivityIndicator } from 'react-native';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

const variants = {
  primary: 'bg-brand-500 border-brand-500',
  secondary: 'bg-transparent border-slate-300 dark:border-slate-600',
  danger: 'bg-red-500 border-red-500',
  ghost: 'bg-transparent border-transparent',
};

const textVariants = {
  primary: 'text-white',
  secondary: 'text-slate-700 dark:text-slate-300',
  danger: 'text-white',
  ghost: 'text-brand-500',
};

const sizes = {
  sm: 'px-3 py-2',
  md: 'px-4 py-3',
  lg: 'px-6 py-4',
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
  style,
  accessibilityLabel,
  children
}: ButtonProps) {
  const isDisabled = loading || disabled;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      className={`
        ${variants[variant]}
        ${sizes[size]}
        rounded-lg border
        ${isDisabled ? 'opacity-50' : ''}
        justify-center items-center flex-row
      `}
      style={[
        { minHeight: 48, minWidth: 48 }, // Minimum touch target size
        style
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? 'white' : '#6366f1'}
        />
      ) : (
        <Text className={`${textVariants[variant]} ${textSizes[size]} font-medium text-center`}>
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}