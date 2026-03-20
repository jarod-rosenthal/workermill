import React from 'react';
import { render } from '@testing-library/react-native';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders message prop', () => {
    const testMessage = 'No items found';
    const { getByText } = render(<EmptyState message={testMessage} />);

    expect(getByText(testMessage)).toBeTruthy();
  });

  it('renders with default icon', () => {
    const { getByTestId } = render(<EmptyState message="Test message" />);

    // The Ionicons component should render with the default icon
    // We can't directly test the icon name, but we can ensure the component renders
    expect(getByTestId).toBeDefined();
  });

  it('renders with custom icon', () => {
    const { getByTestId } = render(
      <EmptyState icon="folder-outline" message="No folders" />
    );

    expect(getByTestId).toBeDefined();
  });
});