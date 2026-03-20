import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StatsBar } from '../StatsBar';

describe('StatsBar', () => {
  const defaultProps = {
    activeWorkers: 3,
    queueDepth: 7,
    periodCost: 15450, // $154.50 in cents
    periodCompleted: 12,
  };

  it('renders all stats with correct values', () => {
    render(<StatsBar {...defaultProps} />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('$154.50')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders all stat labels', () => {
    render(<StatsBar {...defaultProps} />);

    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Queue')).toBeTruthy();
    expect(screen.getByText('Cost')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('has correct accessibility labels for each stat', () => {
    render(<StatsBar {...defaultProps} />);

    expect(screen.getByLabelText('3 active workers')).toBeTruthy();
    expect(screen.getByLabelText('7 tasks in queue')).toBeTruthy();
    expect(screen.getByLabelText('Period cost: $154.50')).toBeTruthy();
    expect(screen.getByLabelText('12 tasks completed')).toBeTruthy();
  });

  it('has correct container accessibility properties', () => {
    render(<StatsBar {...defaultProps} />);

    const container = screen.getByLabelText('Dashboard statistics');
    expect(container.props.accessibilityRole).toBe('text');
  });

  describe('cost formatting', () => {
    it('formats zero cost correctly', () => {
      const props = { ...defaultProps, periodCost: 0 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('$0.00')).toBeTruthy();
      expect(screen.getByLabelText('Period cost: $0.00')).toBeTruthy();
    });

    it('formats cents correctly', () => {
      const props = { ...defaultProps, periodCost: 99 }; // $0.99
      render(<StatsBar {...props} />);

      expect(screen.getByText('$0.99')).toBeTruthy();
      expect(screen.getByLabelText('Period cost: $0.99')).toBeTruthy();
    });

    it('formats large amounts correctly', () => {
      const props = { ...defaultProps, periodCost: 123456 }; // $1234.56
      render(<StatsBar {...props} />);

      expect(screen.getByText('$1234.56')).toBeTruthy();
      expect(screen.getByLabelText('Period cost: $1234.56')).toBeTruthy();
    });

    it('formats single digit cents correctly', () => {
      const props = { ...defaultProps, periodCost: 1005 }; // $10.05
      render(<StatsBar {...props} />);

      expect(screen.getByText('$10.05')).toBeTruthy();
      expect(screen.getByLabelText('Period cost: $10.05')).toBeTruthy();
    });
  });

  describe('active worker count', () => {
    it('handles zero active workers', () => {
      const props = { ...defaultProps, activeWorkers: 0 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('0')).toBeTruthy();
      expect(screen.getByLabelText('0 active workers')).toBeTruthy();
    });

    it('handles single active worker', () => {
      const props = { ...defaultProps, activeWorkers: 1 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('1')).toBeTruthy();
      expect(screen.getByLabelText('1 active workers')).toBeTruthy();
    });

    it('handles large number of active workers', () => {
      const props = { ...defaultProps, activeWorkers: 99 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('99')).toBeTruthy();
      expect(screen.getByLabelText('99 active workers')).toBeTruthy();
    });
  });

  describe('queue depth', () => {
    it('handles zero queue depth', () => {
      const props = { ...defaultProps, queueDepth: 0 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('0')).toBeTruthy();
      expect(screen.getByLabelText('0 tasks in queue')).toBeTruthy();
    });

    it('handles large queue depth', () => {
      const props = { ...defaultProps, queueDepth: 150 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('150')).toBeTruthy();
      expect(screen.getByLabelText('150 tasks in queue')).toBeTruthy();
    });
  });

  describe('completed count', () => {
    it('handles zero completed tasks', () => {
      const props = { ...defaultProps, periodCompleted: 0 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('0')).toBeTruthy();
      expect(screen.getByLabelText('0 tasks completed')).toBeTruthy();
    });

    it('handles large completed count', () => {
      const props = { ...defaultProps, periodCompleted: 999 };
      render(<StatsBar {...props} />);

      expect(screen.getByText('999')).toBeTruthy();
      expect(screen.getByLabelText('999 tasks completed')).toBeTruthy();
    });
  });

  it('applies custom className', () => {
    const { getByLabelText } = render(
      <StatsBar {...defaultProps} className="custom-stats-class" />
    );

    const container = getByLabelText('Dashboard statistics');
    expect(container.props.className).toContain('custom-stats-class');
  });
});