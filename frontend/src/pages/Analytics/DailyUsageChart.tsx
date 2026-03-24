import type { DailyUsage } from "./types";

interface DailyUsageChartProps {
  data: DailyUsage[];
}

export default function DailyUsageChart({ data }: DailyUsageChartProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Daily Task Usage</h2>
      <div className="h-48 flex items-end gap-1">
        {data.map((day, i) => {
          const maxTasks = Math.max(...data.map((d) => d.tasks), 1);
          const height = (day.tasks / maxTasks) * 100;
          return (
            <div
              key={i}
              className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
              style={{ height: `${Math.max(height, 2)}%` }}
              title={`${day.date}: ${day.tasks} tasks`}
            ></div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
