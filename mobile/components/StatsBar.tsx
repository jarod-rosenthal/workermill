import React from 'react';
import { View, Text } from 'react-native';

interface StatsBarProps {
  activeWorkers: number;
  queueDepth: number;
  periodCost: number; // in cents
  periodCompleted: number;
  className?: string;
}

function formatCost(costCents: number): string {
  return `$${(costCents / 100).toFixed(2)}`;
}

export function StatsBar({
  activeWorkers,
  queueDepth,
  periodCost,
  periodCompleted,
  className
}: StatsBarProps) {
  const stats = [
    {
      label: 'Active',
      value: String(activeWorkers ?? 0),
      accessibilityLabel: `${activeWorkers ?? 0} active workers`,
    },
    {
      label: 'Queue',
      value: String(queueDepth ?? 0),
      accessibilityLabel: `${queueDepth ?? 0} tasks in queue`,
    },
    {
      label: 'Cost',
      value: formatCost(periodCost ?? 0),
      accessibilityLabel: `Period cost: ${formatCost(periodCost ?? 0)}`,
    },
    {
      label: 'Completed',
      value: String(periodCompleted ?? 0),
      accessibilityLabel: `${periodCompleted ?? 0} tasks completed`,
    },
  ];

  return (
    <View
      className={`
        bg-white dark:bg-slate-850
        border border-slate-200 dark:border-slate-700
        rounded-lg p-4 flex-row justify-between
        ${className || ''}
      `}
      accessibilityRole="text"
      accessibilityLabel="Dashboard statistics"
    >
      {stats.map((stat, index) => (
        <View key={stat.label} className="flex-1 items-center">
          <Text
            className="text-xl font-semibold text-slate-900 dark:text-slate-100"
            accessibilityLabel={stat.accessibilityLabel}
          >
            {stat.value}
          </Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {stat.label}
          </Text>
          {index < stats.length - 1 && (
            <View className="absolute right-0 top-1 bottom-1 w-px bg-slate-200 dark:bg-slate-700" />
          )}
        </View>
      ))}
    </View>
  );
}