import React from 'react';
import { View, Text } from 'react-native';
import { WorkerTaskStatus } from '../types/tasks';

interface StatusBadgeProps {
  status: WorkerTaskStatus;
}

const getStatusGroup = (status: WorkerTaskStatus): string => {
  if (['executing', 'consolidating', 'deploying', 'running', 'integration_check'].includes(status)) {
    return 'active';
  }
  if (['queued', 'claimed', 'environment_setup', 'dispatching'].includes(status)) {
    return 'queued';
  }
  if (['planning', 'pending_plan_approval'].includes(status)) {
    return 'planning';
  }
  if (['blocked', 'pr_created', 'review_requested', 'manager_review', 'revision_needed', 'pr_approved', 'review_approved', 'escalated'].includes(status)) {
    return 'waiting';
  }
  if (['completed', 'deployed'].includes(status)) {
    return 'completed';
  }
  if (['failed', 'cancelled', 'review_rejected'].includes(status)) {
    return 'failed';
  }
  return 'completed'; // fallback
};

const statusStyles = {
  active: 'bg-green-500 text-white',
  queued: 'bg-yellow-400 text-slate-900',
  planning: 'bg-blue-600 text-white',
  waiting: 'bg-purple-600 text-white',
  completed: 'bg-slate-600 text-white',
  failed: 'bg-red-500 text-white',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const group = getStatusGroup(status);
  const style = statusStyles[group as keyof typeof statusStyles];

  // Format status for display
  const displayStatus = status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <View className={`px-2 py-1 rounded-full ${style}`}>
      <Text className={`text-xs font-medium ${group === 'queued' ? 'text-slate-900' : 'text-white'}`}>
        {displayStatus}
      </Text>
    </View>
  );
}