import React from 'react';
import { View, Text } from 'react-native';

interface StatsBarProps {
  activeWorkers: number;
  queueDepth: number;
  periodCost: number;
  completedTasks: number;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function StatsBar({ activeWorkers, queueDepth, periodCost, completedTasks }: StatsBarProps) {
  return (
    <View className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
      <View className="flex-row justify-between">
        <View className="items-center">
          <Text className="text-2xl font-bold text-green-600 dark:text-green-400">
            {activeWorkers}
          </Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Active
          </Text>
        </View>

        <View className="items-center">
          <Text className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {queueDepth}
          </Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Queued
          </Text>
        </View>

        <View className="items-center">
          <Text className="text-2xl font-bold text-brand-600 dark:text-brand-400">
            {formatCurrency(periodCost)}
          </Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Today
          </Text>
        </View>

        <View className="items-center">
          <Text className="text-2xl font-bold text-slate-600 dark:text-slate-400">
            {completedTasks}
          </Text>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Done
          </Text>
        </View>
      </View>
    </View>
  );
}