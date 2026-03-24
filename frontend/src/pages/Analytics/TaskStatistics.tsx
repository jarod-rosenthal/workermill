import type { TaskStats } from "./types";

interface TaskStatisticsProps {
  data: TaskStats;
}

export default function TaskStatistics({ data }: TaskStatisticsProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Task Statistics</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold">{data.total}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-green-600">
            {data.completed}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Completed
          </p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-blue-600">
            {data.deployed}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Deployed
          </p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-red-600">
            {data.failed}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Failed</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-yellow-600">
            {data.inProgress}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            In Progress
          </p>
        </div>
      </div>

      {data.total > 0 && (
        <div className="mt-6">
          <div className="flex h-4 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
            <div
              className="bg-green-500"
              style={{
                width: `${(data.completed / data.total) * 100}%`,
              }}
            ></div>
            <div
              className="bg-blue-500"
              style={{
                width: `${(data.deployed / data.total) * 100}%`,
              }}
            ></div>
            <div
              className="bg-red-500"
              style={{
                width: `${(data.failed / data.total) * 100}%`,
              }}
            ></div>
            <div
              className="bg-yellow-500"
              style={{
                width: `${(data.inProgress / data.total) * 100}%`,
              }}
            ></div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Completed</span>
            <span>Deployed</span>
            <span>Failed</span>
            <span>In Progress</span>
          </div>
        </div>
      )}
    </div>
  );
}
