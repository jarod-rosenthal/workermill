import React from 'react';
import { View, Text } from 'react-native';
import { WorkerTaskStatus } from '../types/tasks';

interface StatusBadgeProps {
  status: WorkerTaskStatus;
  className?: string;
}

// StatusBadge color mapping as specified - WCAG AA compliant combinations
const statusColors = {
  // Active statuses
  executing: { bg: 'bg-green-500', text: 'text-white' },
  consolidating: { bg: 'bg-green-500', text: 'text-white' },
  deploying: { bg: 'bg-green-500', text: 'text-white' },
  running: { bg: 'bg-green-500', text: 'text-white' },
  integration_check: { bg: 'bg-green-500', text: 'text-white' },

  // Queued statuses
  queued: { bg: 'bg-yellow-400', text: 'text-slate-900' },
  claimed: { bg: 'bg-yellow-400', text: 'text-slate-900' },
  environment_setup: { bg: 'bg-yellow-400', text: 'text-slate-900' },
  dispatching: { bg: 'bg-yellow-400', text: 'text-slate-900' },

  // Planning statuses - using bg-blue-600 for WCAG AA compliance
  planning: { bg: 'bg-blue-600', text: 'text-white' },
  pending_plan_approval: { bg: 'bg-blue-600', text: 'text-white' },

  // Waiting statuses - using bg-purple-600 for WCAG AA compliance
  blocked: { bg: 'bg-purple-600', text: 'text-white' },
  pr_created: { bg: 'bg-purple-600', text: 'text-white' },
  review_requested: { bg: 'bg-purple-600', text: 'text-white' },
  manager_review: { bg: 'bg-purple-600', text: 'text-white' },
  revision_needed: { bg: 'bg-purple-600', text: 'text-white' },
  pr_approved: { bg: 'bg-purple-600', text: 'text-white' },
  review_approved: { bg: 'bg-purple-600', text: 'text-white' },
  escalated: { bg: 'bg-purple-600', text: 'text-white' },

  // Completed statuses - using bg-slate-600 for WCAG AA compliance
  completed: { bg: 'bg-slate-600', text: 'text-white' },
  deployed: { bg: 'bg-slate-600', text: 'text-white' },

  // Failed statuses
  failed: { bg: 'bg-red-500', text: 'text-white' },
  cancelled: { bg: 'bg-red-500', text: 'text-white' },
  review_rejected: { bg: 'bg-red-500', text: 'text-white' },
};

const statusLabels = {
  queued: 'Queued',
  claimed: 'Claimed',
  environment_setup: 'Setting up',
  dispatching: 'Dispatching',
  planning: 'Planning',
  pending_plan_approval: 'Plan Review',
  executing: 'Executing',
  consolidating: 'Consolidating',
  deploying: 'Deploying',
  running: 'Running',
  integration_check: 'Integration',
  blocked: 'Blocked',
  pr_created: 'PR Created',
  review_requested: 'Review',
  manager_review: 'Manager Review',
  revision_needed: 'Revision',
  pr_approved: 'Approved',
  review_approved: 'Review Approved',
  escalated: 'Escalated',
  completed: 'Completed',
  deployed: 'Deployed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  review_rejected: 'Rejected',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colors = statusColors[status];
  const label = statusLabels[status];

  return (
    <View
      className={`px-2 py-1 rounded-full ${colors.bg} ${className || ''}`}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
    >
      <Text
        className={`text-xs font-medium ${colors.text}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}