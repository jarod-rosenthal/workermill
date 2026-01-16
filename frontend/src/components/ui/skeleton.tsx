import { cn } from "../../lib/utils";

/**
 * Base skeleton component with shimmer animation
 * Used for creating loading placeholders that match the shape of actual content
 */
interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-gray-200 dark:bg-gray-700 rounded",
        className
      )}
      style={{ width, height }}
    />
  );
}

/**
 * Skeleton for stats cards (Dashboard header stats)
 */
export function StatsCardSkeleton() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50">
      <Skeleton className="w-4 h-4 rounded" />
      <Skeleton className="w-8 h-4 rounded" />
      <Skeleton className="w-12 h-3 rounded" />
    </div>
  );
}

/**
 * Skeleton for metric tiles (Analytics/Finance views)
 */
export function MetricTileSkeleton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "p-3",
    md: "p-4",
    lg: "p-6",
  };

  const valueSizeClasses = {
    sm: "h-5 w-16",
    md: "h-7 w-20",
    lg: "h-8 w-24",
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800",
        sizeClasses[size]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className={valueSizeClasses[size]} />
        </div>
        <Skeleton className="w-6 h-6 rounded" />
      </div>
    </div>
  );
}

/**
 * Skeleton for task cards (Dashboard active/completed tasks)
 */
export function CardSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-6 w-20 rounded" />
        <Skeleton className="h-4 w-16 rounded" />
      </div>
      <Skeleton className="h-5 w-24 mb-2 rounded" />
      <Skeleton className="h-4 w-3/4 rounded" />
      <div className="flex items-center gap-4 mt-3">
        <Skeleton className="h-4 w-16 rounded" />
        <Skeleton className="h-4 w-16 rounded" />
        <Skeleton className="h-4 w-12 rounded" />
      </div>
    </div>
  );
}

/**
 * Skeleton for table rows (Analytics tables)
 */
export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-700">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={cn("h-4 rounded", i === 0 ? "w-24" : "w-16")} />
        </td>
      ))}
    </tr>
  );
}

/**
 * Skeleton for billing plan cards
 */
export function PlanCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 animate-pulse">
      <Skeleton className="h-6 w-24 mb-2" />
      <Skeleton className="h-8 w-20 mb-1" />
      <Skeleton className="h-4 w-32 mb-1" />
      <Skeleton className="h-4 w-28 mb-4" />
      <div className="space-y-2 mt-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="h-10 w-full mt-6 rounded" />
    </div>
  );
}

/**
 * Dashboard skeleton - shows placeholder for the main dashboard content
 */
export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Header skeleton */}
      <header className="border-b border-border/30 bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Skeleton className="h-7 w-28" />

          {/* Stats bar skeleton */}
          <div className="flex items-center gap-2 flex-1 justify-center">
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
          </div>

          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </div>
      </header>

      {/* Main content skeleton */}
      <div className="flex h-[calc(100vh-60px)]">
        {/* Left sidebar skeleton */}
        <div className="w-64 border-r border-border/30 bg-card/50 p-4">
          <Skeleton className="h-6 w-32 mb-4" />
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>

        {/* Main content area skeleton */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="space-y-4">
            {/* Task cards skeleton */}
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>

        {/* Right sidebar skeleton */}
        <div className="w-72 border-l border-border/30 bg-card/50 p-4">
          <Skeleton className="h-6 w-40 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Analytics skeleton - shows placeholder for analytics page
 */
export function AnalyticsSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <Skeleton className="h-8 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded" />
          <Skeleton className="h-8 w-20 rounded" />
          <Skeleton className="h-8 w-20 rounded" />
        </div>
      </div>

      {/* Usage Overview - 4 stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* Task Statistics Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
        <Skeleton className="h-6 w-36 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="text-center">
              <Skeleton className="h-9 w-12 mx-auto mb-2" />
              <Skeleton className="h-4 w-16 mx-auto" />
            </div>
          ))}
        </div>
        {/* Progress bar skeleton */}
        <div className="mt-6">
          <Skeleton className="h-4 w-full rounded-full" />
          <div className="flex justify-between mt-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>

      {/* Daily Usage Chart skeleton */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <Skeleton className="h-6 w-36 mb-4" />
        <div className="h-48 flex items-end gap-1">
          {/* Using varying heights to simulate chart bars */}
          <Skeleton className="flex-1 rounded-t h-[30%]" />
          <Skeleton className="flex-1 rounded-t h-[50%]" />
          <Skeleton className="flex-1 rounded-t h-[70%]" />
          <Skeleton className="flex-1 rounded-t h-[45%]" />
          <Skeleton className="flex-1 rounded-t h-[60%]" />
          <Skeleton className="flex-1 rounded-t h-[80%]" />
          <Skeleton className="flex-1 rounded-t h-[55%]" />
          <Skeleton className="flex-1 rounded-t h-[40%]" />
          <Skeleton className="flex-1 rounded-t h-[65%]" />
          <Skeleton className="flex-1 rounded-t h-[75%]" />
          <Skeleton className="flex-1 rounded-t h-[35%]" />
          <Skeleton className="flex-1 rounded-t h-[50%]" />
          <Skeleton className="flex-1 rounded-t h-[60%]" />
          <Skeleton className="flex-1 rounded-t h-[45%]" />
          <Skeleton className="flex-1 rounded-t h-[70%]" />
        </div>
        <div className="flex justify-between mt-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

/**
 * Billing skeleton - shows placeholder for billing page
 */
export function BillingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <Skeleton className="h-8 w-40 mb-6" />

      {/* Current Usage Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
        {/* Usage bar skeleton */}
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-8" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <Skeleton className="h-10 w-32 mt-4 rounded" />
      </div>

      {/* Cost Breakdown Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
        <Skeleton className="h-6 w-48 mb-4" />

        {/* Totals Row */}
        <div className="flex flex-wrap gap-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div>
            <Skeleton className="h-4 w-12 mb-2" />
            <Skeleton className="h-8 w-12" />
          </div>
        </div>

        {/* Token Usage */}
        <div className="py-4 border-b border-gray-200 dark:border-gray-700">
          <Skeleton className="h-4 w-28 mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pl-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* By Model and By Persona */}
        <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Skeleton className="h-4 w-20 mb-3" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-24 mb-3" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Plans */}
      <Skeleton className="h-6 w-32 mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <PlanCardSkeleton />
        <PlanCardSkeleton />
        <PlanCardSkeleton />
        <PlanCardSkeleton />
      </div>
    </div>
  );
}

/**
 * Cost breakdown skeleton for inline loading within billing page
 */
export function CostBreakdownSkeleton() {
  return (
    <>
      {/* Totals Row */}
      <div className="flex flex-wrap gap-6 pb-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div>
          <Skeleton className="h-4 w-12 mb-2" />
          <Skeleton className="h-8 w-12" />
        </div>
      </div>

      {/* Token Usage */}
      <div className="py-4 border-b border-gray-200 dark:border-gray-700">
        <Skeleton className="h-4 w-28 mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pl-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      {/* By Model and By Persona */}
      <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Skeleton className="h-4 w-20 mb-3" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div>
          <Skeleton className="h-4 w-24 mb-3" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </>
  );
}

export default Skeleton;
