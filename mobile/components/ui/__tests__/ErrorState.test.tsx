import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('renders message prop', () => {
    const testMessage = 'Something went wrong';
    const { getByText } = render(<ErrorState message={testMessage} />);

    expect(getByText(testMessage)).toBeTruthy();
  });

  it('calls onRetry when button is pressed', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <ErrorState message="Error occurred" onRetry={onRetry} />
    );

    const retryButton = getByText('Try again');
    fireEvent.press(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    const { queryByText } = render(<ErrorState message="Error occurred" />);

    expect(queryByText('Try again')).toBeNull();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <ErrorState message="Error occurred" onRetry={onRetry} />
    );

    expect(getByText('Try again')).toBeTruthy();
  });
});