import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BoardCard } from '../BoardCard';
import { Card } from '../../types/boards';

// Mock the StatusBadge component
jest.mock('../StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => {
    const { Text } = require('react-native');
    return <Text testID="status-badge">{status}</Text>;
  },
}));

describe('BoardCard', () => {
  const mockCard: Card = {
    id: 'card-1',
    boardId: 'board-1',
    columnId: 'column-1',
    issueKey: 'WM-123',
    title: 'Test Card Title',
    description: 'Test card description',
    priority: 'high',
    position: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    labels: [
      {
        id: 'label-1',
        name: 'Feature',
        color: '#3b82f6',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'label-2',
        name: 'High Priority',
        color: '#ef4444',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
    checklistItems: [
      {
        id: 'item-1',
        cardId: 'card-1',
        title: 'Task 1',
        isCompleted: true,
        position: 1,
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'item-2',
        cardId: 'card-1',
        title: 'Task 2',
        isCompleted: false,
        position: 2,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
    dependencies: [],
    dependents: [],
  };

  const mockOnPress = jest.fn();
  const mockOnLongPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders card with basic information', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    expect(screen.getByText('WM-123')).toBeTruthy();
    expect(screen.getByText('Test Card Title')).toBeTruthy();
  });

  it('displays labels correctly', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    expect(screen.getByText('Feature')).toBeTruthy();
    expect(screen.getByText('High Priority')).toBeTruthy();
  });

  it('shows checklist progress indicator', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    // Should show "1/2" for 1 completed out of 2 total items
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('does not show checklist progress when no checklist items', () => {
    const cardWithoutChecklist = { ...mockCard, checklistItems: [] };
    render(<BoardCard card={cardWithoutChecklist} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    expect(screen.queryByText('0/0')).toBeNull();
  });

  it('shows worker status badge when linked task exists', () => {
    const cardWithTask = { ...mockCard, workerStatus: 'running' };
    render(<BoardCard card={cardWithTask} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    expect(screen.getByTestId('status-badge')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('does not show status badge when no linked task', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    expect(screen.queryByTestId('status-badge')).toBeNull();
  });

  it('calls onPress when card is pressed', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    const card = screen.getByRole('button');
    fireEvent.press(card);

    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('calls onLongPress when card is long pressed', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    const card = screen.getByRole('button');
    fireEvent(card, 'onLongPress');

    expect(mockOnLongPress).toHaveBeenCalledTimes(1);
  });

  it('applies correct priority color class for high priority', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    const card = screen.getByRole('button').children[0];
    expect(card.props.className).toContain('border-l-orange-500');
  });

  it('applies correct priority color class for urgent priority', () => {
    const urgentCard = { ...mockCard, priority: 'urgent' as const };
    render(<BoardCard card={urgentCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    const card = screen.getByRole('button').children[0];
    expect(card.props.className).toContain('border-l-red-500');
  });

  it('has accessibility labels', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    const card = screen.getByRole('button');
    expect(card.props.accessibilityLabel).toBe('Card WM-123: Test Card Title');
    expect(card.props.accessibilityHint).toBe('Double tap to open card details, long press for options');
  });

  it('meets minimum touch target requirements', () => {
    render(<BoardCard card={mockCard} onPress={mockOnPress} onLongPress={mockOnLongPress} />);

    const card = screen.getByRole('button');
    expect(card.props.style.minHeight).toBe(48);
    expect(card.props.style.minWidth).toBe(48);
  });
});
