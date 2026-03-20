import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusBadge } from '../StatusBadge';
import { WorkerTaskStatus } from '../../types/tasks';

describe('StatusBadge', () => {
  // Test all status groups with exact Tailwind classes and text colors
  describe('Active status group', () => {
    const activeStatuses: WorkerTaskStatus[] = [
      'executing',
      'consolidating',
      'deploying',
      'running',
      'integration_check'
    ];

    activeStatuses.forEach(status => {
      it(`renders ${status} with bg-green-500 and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);
        const badge = getByText(getExpectedLabel(status)).parent?.parent;

        expect(badge?.props.className).toContain('bg-green-500');
        expect(getByText(getExpectedLabel(status)).props.className).toContain('text-white');
      });
    });
  });

  describe('Queued status group', () => {
    const queuedStatuses: WorkerTaskStatus[] = [
      'queued',
      'claimed',
      'environment_setup',
      'dispatching'
    ];

    queuedStatuses.forEach(status => {
      it(`renders ${status} with bg-yellow-400 and text-slate-900`, () => {
        const { getByText } = render(<StatusBadge status={status} />);
        const badge = getByText(getExpectedLabel(status)).parent?.parent;

        expect(badge?.props.className).toContain('bg-yellow-400');
        expect(getByText(getExpectedLabel(status)).props.className).toContain('text-slate-900');
      });
    });
  });

  describe('Planning status group', () => {
    const planningStatuses: WorkerTaskStatus[] = [
      'planning',
      'pending_plan_approval'
    ];

    planningStatuses.forEach(status => {
      it(`renders ${status} with bg-blue-600 and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);
        const badge = getByText(getExpectedLabel(status)).parent?.parent;

        expect(badge?.props.className).toContain('bg-blue-600');
        expect(getByText(getExpectedLabel(status)).props.className).toContain('text-white');
      });
    });
  });

  describe('Waiting status group', () => {
    const waitingStatuses: WorkerTaskStatus[] = [
      'blocked',
      'pr_created',
      'review_requested',
      'manager_review',
      'revision_needed',
      'pr_approved',
      'review_approved',
      'escalated'
    ];

    waitingStatuses.forEach(status => {
      it(`renders ${status} with bg-purple-600 and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);
        const badge = getByText(getExpectedLabel(status)).parent?.parent;

        expect(badge?.props.className).toContain('bg-purple-600');
        expect(getByText(getExpectedLabel(status)).props.className).toContain('text-white');
      });
    });
  });

  describe('Completed status group', () => {
    const completedStatuses: WorkerTaskStatus[] = [
      'completed',
      'deployed'
    ];

    completedStatuses.forEach(status => {
      it(`renders ${status} with bg-slate-600 and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);
        const badge = getByText(getExpectedLabel(status)).parent?.parent;

        expect(badge?.props.className).toContain('bg-slate-600');
        expect(getByText(getExpectedLabel(status)).props.className).toContain('text-white');
      });
    });
  });

  describe('Failed status group', () => {
    const failedStatuses: WorkerTaskStatus[] = [
      'failed',
      'cancelled',
      'review_rejected'
    ];

    failedStatuses.forEach(status => {
      it(`renders ${status} with bg-red-500 and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);
        const badge = getByText(getExpectedLabel(status)).parent?.parent;

        expect(badge?.props.className).toContain('bg-red-500');
        expect(getByText(getExpectedLabel(status)).props.className).toContain('text-white');
      });
    });
  });

  it('has correct accessibility properties', () => {
    const { getByLabelText } = render(<StatusBadge status="executing" />);

    const element = getByLabelText('Status: Executing');
    expect(element.props.accessibilityRole).toBe('text');
  });

  it('applies custom className', () => {
    const { getByText } = render(<StatusBadge status="completed" className="custom-class" />);
    const badge = getByText('Completed').parent?.parent;

    expect(badge?.props.className).toContain('custom-class');
  });
});

// Helper function to get expected label for status
function getExpectedLabel(status: WorkerTaskStatus): string {
  const statusLabels: Record<WorkerTaskStatus, string> = {
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

  return statusLabels[status];
}