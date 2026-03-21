import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TaskListItem } from '../TaskListItem';
import { WorkerTask } from '../../types/tasks';

const mockTask: WorkerTask = {
  id: 'test-task-1',
  jiraIssueKey: 'WM-123',
  summary: 'Implement user authentication system',
  status: 'executing',
  workerPersona: 'Backend Developer',
  createdAt: '2024-01-15T10:00:00Z',
  startedAt: '2024-01-15T10:05:00Z',
  completedAt: '2024-01-15T10:07:05Z', // 2 minutes 5 seconds after startedAt
  estimatedCostUsd: 2.50,
  retryCount: 0,
  workflowMode: 'auto',
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

  it('renders robot emoji and persona name', () => {
    render(<TaskListItem task={mockTask} />);

    const personaText = screen.getByLabelText('Worker: Backend Developer');
    expect(personaText).toBeTruthy();
    expect(screen.getByText('🤖 Backend Developer')).toBeTruthy();
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

  it('handles task without started time', () => {
    const taskWithoutTime = { ...mockTask, startedAt: undefined, completedAt: undefined };
    render(<TaskListItem task={taskWithoutTime} />);

    expect(screen.getByText('WM-123')).toBeTruthy();
    expect(screen.queryByLabelText(/Duration:/)).toBeNull();
  });

  it('handles task without cost', () => {
    const taskWithoutCost = { ...mockTask, estimatedCostUsd: undefined, costUsd: undefined };
    render(<TaskListItem task={taskWithoutCost} />);

    expect(screen.getByText('WM-123')).toBeTruthy();
    expect(screen.queryByLabelText(/Cost:/)).toBeNull();
  });

  it('handles task without persona', () => {
    const taskWithoutPersona = { ...mockTask, workerPersona: undefined };
    render(<TaskListItem task={taskWithoutPersona} />);

    expect(screen.queryByLabelText(/Worker:/)).toBeNull();
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
        startedAt: '2024-01-15T10:00:00Z',
        completedAt: '2024-01-15T11:01:05Z', // 1 hour, 1 minute, 5 seconds
      };
      render(<TaskListItem task={taskWithHours} />);

      expect(screen.getByLabelText('Duration: 1h 1m')).toBeTruthy();
      expect(screen.getByText('1h 1m')).toBeTruthy();
    });

    it('formats minutes and seconds correctly', () => {
      const taskWithMinutes = {
        ...mockTask,
        startedAt: '2024-01-15T10:00:00Z',
        completedAt: '2024-01-15T10:01:05Z', // 1 minute, 5 seconds
      };
      render(<TaskListItem task={taskWithMinutes} />);

      expect(screen.getByLabelText('Duration: 1m 5s')).toBeTruthy();
      expect(screen.getByText('1m 5s')).toBeTruthy();
    });

    it('formats seconds correctly', () => {
      const taskWithSeconds = {
        ...mockTask,
        startedAt: '2024-01-15T10:00:00Z',
        completedAt: '2024-01-15T10:00:30Z', // 30 seconds
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
        estimatedCostUsd: 123.45,
      };
      render(<TaskListItem task={taskWithHighCost} />);

      expect(screen.getByLabelText('Cost: $123.45')).toBeTruthy();
      expect(screen.getByText('$123.45')).toBeTruthy();
    });

    it('formats zero cost correctly', () => {
      const taskWithZeroCost = {
        ...mockTask,
        estimatedCostUsd: 0,
      };
      render(<TaskListItem task={taskWithZeroCost} />);

      expect(screen.queryByLabelText(/Cost:/)).toBeNull();
    });
  });
});
