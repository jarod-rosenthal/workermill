import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusBadge } from '../StatusBadge';
import { WorkerTaskStatus } from '../../types/tasks';

describe('StatusBadge', () => {
  describe('Active status group', () => {
    const activeStatuses: WorkerTaskStatus[] = ['executing', 'consolidating', 'deploying', 'running', 'integration_check'];

    activeStatuses.forEach(status => {
      it(`renders ${status} with bg-green-500 class and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);

        const statusText = getByText(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        expect(statusText).toBeTruthy();

        // Check that the badge has the correct styles applied
        const badge = statusText.parent;
        expect(badge?.props.className).toContain('bg-green-500');
        expect(statusText.props.className).toContain('text-white');
      });
    });
  });

  describe('Queued status group', () => {
    const queuedStatuses: WorkerTaskStatus[] = ['queued', 'claimed', 'environment_setup', 'dispatching'];

    queuedStatuses.forEach(status => {
      it(`renders ${status} with bg-yellow-400 class and text-slate-900`, () => {
        const { getByText } = render(<StatusBadge status={status} />);

        const statusText = getByText(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        expect(statusText).toBeTruthy();

        const badge = statusText.parent;
        expect(badge?.props.className).toContain('bg-yellow-400');
        expect(statusText.props.className).toContain('text-slate-900');
      });
    });
  });

  describe('Planning status group', () => {
    const planningStatuses: WorkerTaskStatus[] = ['planning', 'pending_plan_approval'];

    planningStatuses.forEach(status => {
      it(`renders ${status} with bg-blue-600 class and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);

        const statusText = getByText(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        expect(statusText).toBeTruthy();

        const badge = statusText.parent;
        expect(badge?.props.className).toContain('bg-blue-600');
        expect(statusText.props.className).toContain('text-white');
      });
    });
  });

  describe('Waiting status group', () => {
    const waitingStatuses: WorkerTaskStatus[] = ['blocked', 'pr_created', 'review_requested', 'manager_review', 'revision_needed', 'pr_approved', 'review_approved', 'escalated'];

    waitingStatuses.forEach(status => {
      it(`renders ${status} with bg-purple-600 class and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);

        const statusText = getByText(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        expect(statusText).toBeTruthy();

        const badge = statusText.parent;
        expect(badge?.props.className).toContain('bg-purple-600');
        expect(statusText.props.className).toContain('text-white');
      });
    });
  });

  describe('Completed status group', () => {
    const completedStatuses: WorkerTaskStatus[] = ['completed', 'deployed'];

    completedStatuses.forEach(status => {
      it(`renders ${status} with bg-slate-600 class and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);

        const statusText = getByText(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        expect(statusText).toBeTruthy();

        const badge = statusText.parent;
        expect(badge?.props.className).toContain('bg-slate-600');
        expect(statusText.props.className).toContain('text-white');
      });
    });
  });

  describe('Failed status group', () => {
    const failedStatuses: WorkerTaskStatus[] = ['failed', 'cancelled', 'review_rejected'];

    failedStatuses.forEach(status => {
      it(`renders ${status} with bg-red-500 class and text-white`, () => {
        const { getByText } = render(<StatusBadge status={status} />);

        const statusText = getByText(status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        expect(statusText).toBeTruthy();

        const badge = statusText.parent;
        expect(badge?.props.className).toContain('bg-red-500');
        expect(statusText.props.className).toContain('text-white');
      });
    });
  });
});