import React from 'react';
import { render } from '@testing-library/react-native';
import { StatsBar } from '../StatsBar';

describe('StatsBar', () => {
  it('formats active count correctly', () => {
    const { getByText } = render(
      <StatsBar
        activeWorkers={5}
        queueDepth={12}
        periodCost={15075}
        completedTasks={42}
      />
    );

    expect(getByText('5')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();
  });

  it('formats queue depth correctly', () => {
    const { getByText } = render(
      <StatsBar
        activeWorkers={3}
        queueDepth={8}
        periodCost={5000}
        completedTasks={20}
      />
    );

    expect(getByText('8')).toBeTruthy();
    expect(getByText('Queued')).toBeTruthy();
  });

  it('formats cost correctly', () => {
    const { getByText } = render(
      <StatsBar
        activeWorkers={2}
        queueDepth={6}
        periodCost={12345}
        completedTasks={15}
      />
    );

    expect(getByText('$123.45')).toBeTruthy();
    expect(getByText('Today')).toBeTruthy();
  });

  it('formats completed tasks correctly', () => {
    const { getByText } = render(
      <StatsBar
        activeWorkers={1}
        queueDepth={3}
        periodCost={7500}
        completedTasks={25}
      />
    );

    expect(getByText('25')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
  });

  it('handles zero values', () => {
    const { getByText } = render(
      <StatsBar
        activeWorkers={0}
        queueDepth={0}
        periodCost={0}
        completedTasks={0}
      />
    );

    expect(getByText('0')).toBeTruthy();
    expect(getByText('$0.00')).toBeTruthy();
  });

  it('formats large numbers correctly', () => {
    const { getByText } = render(
      <StatsBar
        activeWorkers={999}
        queueDepth={1234}
        periodCost={999999}
        completedTasks={5678}
      />
    );

    expect(getByText('999')).toBeTruthy();
    expect(getByText('1234')).toBeTruthy();
    expect(getByText('$9999.99')).toBeTruthy();
    expect(getByText('5678')).toBeTruthy();
  });
});