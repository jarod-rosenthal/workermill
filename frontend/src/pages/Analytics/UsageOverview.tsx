import type { UsageStats } from "./types";

interface UsageOverviewProps {
  data: UsageStats;
}

export default function UsageOverview({ data }: UsageOverviewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Plan</p>
        <p className="text-2xl font-bold capitalize">{data.plan}</p>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Tasks Used
        </p>
        <p className="text-2xl font-bold">
          {data.tasks.isUnlimited
            ? `${data.tasks.used}`
            : `${data.tasks.used} / ${data.tasks.quota}`}
        </p>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Usage
        </p>
        <p className="text-2xl font-bold">
          {data.tasks.isUnlimited ? "Unlimited" : `${data.tasks.percent}%`}
        </p>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Days Until Reset
        </p>
        <p className="text-2xl font-bold">{data.billingPeriod.daysUntilReset}</p>
      </div>
    </div>
  );
}
