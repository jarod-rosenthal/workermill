import { useMemo } from 'react';

interface CostSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  colorMode?: 'static' | 'velocity';
}

export function CostSparkline({
  data,
  width = 80,
  height = 20,
  colorMode = 'velocity',
}: CostSparklineProps) {
  const { bars } = useMemo(() => {
    if (data.length === 0) return { bars: [] };

    const maxVal = Math.max(...data, 0.01); // Avoid division by zero
    const bars = data.map((val, i) => {
      const prevVal = i > 0 ? data[i - 1] : val;
      const velocity = val - prevVal;
      return {
        height: (val / maxVal) * 100,
        velocity,
      };
    });

    return { bars };
  }, [data]);

  if (bars.length === 0) {
    return null;
  }

  const getBarColor = (velocity: number): string => {
    if (colorMode === 'static') {
      return 'var(--mc-status-active)';
    }

    // Color based on velocity (cost increase rate)
    if (velocity < 0.001) return 'var(--mc-cost-low)';
    if (velocity < 0.01) return 'var(--mc-cost-medium)';
    return 'var(--mc-cost-high)';
  };

  const barWidth = Math.max(2, Math.floor((width - bars.length) / bars.length));

  return (
    <div
      className="mc-sparkline"
      style={{ width, height }}
      title={`Cost history: $${data[0]?.toFixed(2) || '0.00'} → $${data[data.length - 1]?.toFixed(2) || '0.00'}`}
    >
      {bars.map((bar, i) => (
        <div
          key={i}
          className="mc-sparkline-bar"
          style={{
            width: barWidth,
            height: `${Math.max(2, bar.height)}%`,
            backgroundColor: getBarColor(bar.velocity),
          }}
        />
      ))}
    </div>
  );
}
