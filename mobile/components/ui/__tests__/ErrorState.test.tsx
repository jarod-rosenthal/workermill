import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('renders the provided error message', () => {
    const message = 'Something went wrong';
    const mockOnRetry = jest.fn();

    render(<ErrorState message={message} onRetry={mockOnRetry} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByLabelText(message)).toBeTruthy();
  });

  it('renders the retry button with correct label', () => {
    const message = 'Failed to load data';
    const mockOnRetry = jest.fn();

    render(<ErrorState message={message} onRetry={mockOnRetry} />);

    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
  });

  it('calls onRetry when retry button is pressed', () => {
    const message = 'Network error';
    const mockOnRetry = jest.fn();

    render(<ErrorState message={message} onRetry={mockOnRetry} />);

    const retryButton = screen.getByLabelText('Try again');
    fireEvent.press(retryButton);

    expect(mockOnRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry multiple times when button is pressed repeatedly', () => {
    const message = 'Server error';
    const mockOnRetry = jest.fn();

    render(<ErrorState message={message} onRetry={mockOnRetry} />);

    const retryButton = screen.getByLabelText('Try again');
    fireEvent.press(retryButton);
    fireEvent.press(retryButton);
    fireEvent.press(retryButton);

    expect(mockOnRetry).toHaveBeenCalledTimes(3);
  });

  it('has correct accessibility properties', () => {
    const message = 'Accessible error state';
    const mockOnRetry = jest.fn();

    render(<ErrorState message={message} onRetry={mockOnRetry} />);

    const container = screen.getByLabelText(message);
    expect(container.props.accessibilityRole).toBe('text');

    const button = screen.getByLabelText('Try again');
    expect(button.props.accessibilityRole).toBe('button');
  });

  it('applies custom className', () => {
    const message = 'Custom error';
    const mockOnRetry = jest.fn();
    const customClass = 'custom-error-class';

    render(<ErrorState message={message} onRetry={mockOnRetry} className={customClass} />);

    expect(screen.getByLabelText(message)).toBeTruthy();
  });
});