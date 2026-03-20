import React from 'react';
import { render, act } from '@testing-library/react-native';
import { TaskListItem } from '../TaskListItem';
import { WorkerTask } from '../../types/tasks';

// Mock the StatusBadge component since we're testing it separately
jest.mock('../StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'status-badge' }, status);
  }
}));

describe('TaskListItem', () => {
  const mockTask: WorkerTask = {
    id: 'task-1',
    issue_key: 'WM-42',
    summary: 'Test task summary',
    status: 'executing',
    persona: 'Frontend Developer',
    persona_emoji: '🎨',
    created_at: '2024-01-01T10:00:00Z',
    started_at: '2024-01-01T10:00:00Z',
    elapsed_time_ms: 120000,
    cost_cents: 250,
    retry_count: 0,
    workflow_mode: 'auto',
  };

  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders status badge', () => {
    const { getByTestId } = render(
      <TaskListItem task={mockTask} onPress={mockOnPress} />
    );

    expect(getByTestId('status-badge')).toBeTruthy();
  });

  it('renders persona emoji', () => {
    const { getByText } = render(
      <TaskListItem task={mockTask} onPress={mockOnPress} />
    );

    expect(getByText('🎨')).toBeTruthy();
    expect(getByText('Frontend Developer')).toBeTruthy();
  });

  it('renders elapsed time', () => {
    const { getByText } = render(
      <TaskListItem task={mockTask} onPress={mockOnPress} />
    );

    expect(getByText('2m 0s')).toBeTruthy();
  });

  it('renders cost', () => {
    const { getByText } = render(
      <TaskListItem task={mockTask} onPress={mockOnPress} />
    );

    expect(getByText('$2.50')).toBeTruthy();
  });

  it('renders task details', () => {
    const { getByText } = render(
      <TaskListItem task={mockTask} onPress={mockOnPress} />
    );

    expect(getByText('WM-42')).toBeTruthy();
    expect(getByText('Test task summary')).toBeTruthy();
  });

  it('handles fallback persona emoji', () => {
    const taskWithoutEmoji = { ...mockTask, persona_emoji: undefined };
    const { getByText } = render(
      <TaskListItem task={taskWithoutEmoji} onPress={mockOnPress} />
    );

    expect(getByText('🤖')).toBeTruthy();
  });

  it('handles zero cost', () => {
    const taskWithNoCost = { ...mockTask, cost_cents: undefined };
    const { getByText } = render(
      <TaskListItem task={taskWithNoCost} onPress={mockOnPress} />
    );

    expect(getByText('$0.00')).toBeTruthy();
  });

  it('updates elapsed time for active tasks', () => {
    const activeTask = {
      ...mockTask,
      status: 'executing' as const,
      started_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
    };

    const { getByText } = render(
      <TaskListItem task={activeTask} onPress={mockOnPress} />
    );

    // Fast forward time by 1 second
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // Should show approximately 1 minute elapsed time
    expect(getByText(/1m/)).toBeTruthy();
  });
});