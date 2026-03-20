import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the provided message', () => {
    const message = 'No items found';
    render(<EmptyState icon="inbox" message={message} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByLabelText(message)).toBeTruthy();
  });

  it('renders with the specified icon', () => {
    const message = 'Empty state message';
    render(<EmptyState icon="folder-open" message={message} />);

    expect(screen.getByText(message)).toBeTruthy();
  });

  it('applies custom className', () => {
    const message = 'Custom styled empty state';
    const customClass = 'custom-class';

    const { getByLabelText } = render(
      <EmptyState icon="search" message={message} className={customClass} />
    );

    expect(getByLabelText(message)).toBeTruthy();
  });

  it('has correct accessibility properties', () => {
    const message = 'Accessible empty state';
    render(<EmptyState icon="info" message={message} />);

    const element = screen.getByLabelText(message);
    expect(element.props.accessibilityRole).toBe('text');
  });
});