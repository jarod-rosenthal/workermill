import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TaskListItem } from '../TaskListItem';
import { WorkerTask } from '../../types/tasks';

const mockTask: WorkerTask = {
  id: 'test-task-1',
  issue_key: 'WM-123',
  summary: 'Implement user authentication system',
  status: 'executing',
  persona: 'Backend Developer',
  persona_emoji: '🔧',
  created_at: '2024-01-15T10:00:00Z',
  started_at: '2024-01-15T10:05:00Z',
  elapsed_time_ms: 125000, // 2 minutes 5 seconds
  cost_cents: 250, // $2.50
  retry_count: 0,
  workflow_mode: 'auto' as const,
};

describe('TaskListItem', () => {
  it('renders task issue key and summary', () => {
    render(<TaskListItem task={mockTask} />);

    expect(screen.getByText('WM-123')).toBeTruthy();
    expect(screen.getByText('Implement user authentication system')).toBeTruthy();
  });

  it('renders status badge', () => {
    render(<TaskListItem task={mockTask} />);

    // StatusBadge should render the status
    expect(screen.getByText('Executing')).toBeTruthy();
  });

  it('renders persona emoji and name', () => {
    render(<TaskListItem task={mockTask} />);

    const personaText = screen.getByLabelText('Worker: Backend Developer');
    expect(personaText).toBeTruthy();
    expect(screen.getByText('🔧 Backend Developer')).toBeTruthy();
  });

  it('renders elapsed time when provided', () => {
    render(<TaskListItem task={mockTask} />);

    const elapsedTimeElement = screen.getByLabelText('Duration: 2m 5s');
    expect(elapsedTimeElement).toBeTruthy();
    expect(screen.getByText('2m 5s')).toBeTruthy();
  });

  it('renders cost when provided', () => {
    render(<TaskListItem task={mockTask} />);

    const costElement = screen.getByLabelText('Cost: $2.50');
    expect(costElement).toBeTruthy();
    expect(screen.getByText('$2.50')).toBeTruthy();
  });

  it('handles task without elapsed time', () => {
    const taskWithoutTime = { ...mockTask, elapsed_time_ms: undefined };
    render(<TaskListItem task={taskWithoutTime} />);

    expect(screen.getByText('WM-123')).toBeTruthy();
    expect(screen.queryByLabelText(/Duration:/)).toBeNull();
  });

  it('handles task without cost', () => {
    const taskWithoutCost = { ...mockTask, cost_cents: undefined };
    render(<TaskListItem task={taskWithoutCost} />);

    expect(screen.getByText('WM-123')).toBeTruthy();
    expect(screen.queryByLabelText(/Cost:/)).toBeNull();
  });

  it('handles task without persona emoji', () => {
    const taskWithoutEmoji = { ...mockTask, persona_emoji: undefined };
    render(<TaskListItem task={taskWithoutEmoji} />);

    expect(screen.getByText('🤖 Backend Developer')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const mockOnPress = jest.fn();
    render(<TaskListItem task={mockTask} onPress={mockOnPress} />);

    const taskItem = screen.getByLabelText('Task WM-123: Implement user authentication system');
    fireEvent.press(taskItem);

    expect(mockOnPress).toHaveBeenCalledTimes(1);
    expect(mockOnPress).toHaveBeenCalledWith(mockTask);
  });

  it('has correct accessibility properties', () => {
    render(<TaskListItem task={mockTask} />);

    const taskItem = screen.getByLabelText('Task WM-123: Implement user authentication system');
    expect(taskItem.props.accessibilityRole).toBe('button');
  });

  describe('elapsed time formatting', () => {
    it('formats hours and minutes correctly', () => {
      const taskWithHours = {
        ...mockTask,
        elapsed_time_ms: 3665000, // 1 hour, 1 minute, 5 seconds
      };
      render(<TaskListItem task={taskWithHours} />);

      expect(screen.getByLabelText('Duration: 1h 1m')).toBeTruthy();
      expect(screen.getByText('1h 1m')).toBeTruthy();
    });

    it('formats minutes and seconds correctly', () => {
      const taskWithMinutes = {
        ...mockTask,
        elapsed_time_ms: 65000, // 1 minute, 5 seconds
      };
      render(<TaskListItem task={taskWithMinutes} />);

      expect(screen.getByLabelText('Duration: 1m 5s')).toBeTruthy();
      expect(screen.getByText('1m 5s')).toBeTruthy();
    });

    it('formats seconds correctly', () => {
      const taskWithSeconds = {
        ...mockTask,
        elapsed_time_ms: 30000, // 30 seconds
      };
      render(<TaskListItem task={taskWithSeconds} />);

      expect(screen.getByLabelText('Duration: 30s')).toBeTruthy();
      expect(screen.getByText('30s')).toBeTruthy();
    });
  });

  describe('cost formatting', () => {
    it('formats dollars and cents correctly', () => {
      const taskWithHighCost = {
        ...mockTask,
        cost_cents: 12345, // $123.45
      };
      render(<TaskListItem task={taskWithHighCost} />);

      expect(screen.getByLabelText('Cost: $123.45')).toBeTruthy();
      expect(screen.getByText('$123.45')).toBeTruthy();
    });

    it('formats zero cost correctly', () => {
      const taskWithZeroCost = {
        ...mockTask,
        cost_cents: 0,
      };
      render(<TaskListItem task={taskWithZeroCost} />);

      expect(screen.queryByLabelText(/Cost:/)).toBeNull();
    });
  });
});