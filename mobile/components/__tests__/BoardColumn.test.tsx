import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BoardColumn } from '../BoardColumn';
import { Column, Card } from '../../types/boards';

// Mock the BoardCard component
jest.mock('../BoardCard', () => ({
  BoardCard: ({ card, onPress, onLongPress }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity
        testID={`card-${card.id}`}
        onPress={() => onPress?.(card)}
        onLongPress={() => onLongPress?.(card)}
      >
        <Text>{card.title}</Text>
      </TouchableOpacity>
    );
  },
}));

// Mock the EmptyState component
jest.mock('../ui/EmptyState', () => ({
  EmptyState: ({ message }: { message: string }) => {
    const { Text } = require('react-native');
    return <Text testID="empty-state">{message}</Text>;
  },
}));

describe('BoardColumn', () => {
  const mockCards: Card[] = [
    {
      id: 'card-1',
      board_id: 'board-1',
      column_id: 'column-1',
      issue_key: 'WM-123',
      title: 'First Card',
      priority: 'high',
      position: 1,
      created_by: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      labels: [],
      checklist_items: [],
      dependencies: [],
    },
    {
      id: 'card-2',
      board_id: 'board-1',
      column_id: 'column-1',
      issue_key: 'WM-124',
      title: 'Second Card',
      priority: 'medium',
      position: 2,
      created_by: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      labels: [],
      checklist_items: [],
      dependencies: [],
    },
  ];

  const mockColumn: Column = {
    id: 'column-1',
    board_id: 'board-1',
    name: 'To Do',
    position: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    cards: mockCards,
  };

  const mockOnCardPress = jest.fn();
  const mockOnCardLongPress = jest.fn();
  const mockOnAddCard = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders column header with name and card count', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    expect(screen.getByText('To Do')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // Card count
  });

  it('renders all cards in the column', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    expect(screen.getByText('First Card')).toBeTruthy();
    expect(screen.getByText('Second Card')).toBeTruthy();
    expect(screen.getByTestId('card-card-1')).toBeTruthy();
    expect(screen.getByTestId('card-card-2')).toBeTruthy();
  });

  it('shows empty state when column has no cards', () => {
    const emptyColumn = { ...mockColumn, cards: [] };
    render(
      <BoardColumn
        column={emptyColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No cards')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy(); // Card count should be 0
  });

  it('calls onCardPress when card is pressed', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    fireEvent.press(screen.getByTestId('card-card-1'));

    expect(mockOnCardPress).toHaveBeenCalledTimes(1);
    expect(mockOnCardPress).toHaveBeenCalledWith(mockCards[0]);
  });

  it('calls onCardLongPress when card is long pressed', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    fireEvent(screen.getByTestId('card-card-1'), 'onLongPress');

    expect(mockOnCardLongPress).toHaveBeenCalledTimes(1);
    expect(mockOnCardLongPress).toHaveBeenCalledWith(mockCards[0]);
  });

  it('shows add card button when onAddCard is provided', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    const addButton = screen.getByRole('button', { name: `Add card to ${mockColumn.name} column` });
    expect(addButton).toBeTruthy();
    expect(screen.getByText('Add card')).toBeTruthy();
  });

  it('does not show add card button when onAddCard is not provided', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
      />
    );

    expect(screen.queryByText('Add card')).toBeNull();
  });

  it('calls onAddCard when add card button is pressed', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    const addButton = screen.getByRole('button', { name: `Add card to ${mockColumn.name} column` });
    fireEvent.press(addButton);

    expect(mockOnAddCard).toHaveBeenCalledTimes(1);
    expect(mockOnAddCard).toHaveBeenCalledWith(mockColumn.id);
  });

  it('has proper accessibility attributes', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    // Check ScrollView accessibility
    const scrollView = screen.getByLabelText(`${mockColumn.name} column cards`);
    expect(scrollView.props.accessibilityLabel).toBe(`${mockColumn.name} column cards`);

    // Check add button accessibility
    const addButton = screen.getByRole('button', { name: `Add card to ${mockColumn.name} column` });
    expect(addButton.props.accessibilityLabel).toBe(`Add card to ${mockColumn.name} column`);
  });

  it('meets minimum touch target requirements for add button', () => {
    render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    const addButton = screen.getByRole('button', { name: `Add card to ${mockColumn.name} column` });
    expect(addButton.props.style.minHeight).toBe(48);
    expect(addButton.props.style.minWidth).toBe(48);
  });

  it('has proper column styling and width', () => {
    const { UNSAFE_getByProps } = render(
      <BoardColumn
        column={mockColumn}
        onCardPress={mockOnCardPress}
        onCardLongPress={mockOnCardLongPress}
        onAddCard={mockOnAddCard}
      />
    );

    // The root View should have the proper styling class
    const columnContainer = UNSAFE_getByProps({ className: 'w-80 mr-4 bg-slate-50 dark:bg-slate-900 rounded-lg' });
    expect(columnContainer).toBeTruthy();
  });
});