
interface CreditBalance {
  totalCents: number;
  freeCreditsRemaining: number;
  paidCredits: number;
}

interface CreditBalanceCardProps {
  balance: CreditBalance;
  paused: boolean;
  pausedReason?: string | null;
  onAddCredits: () => void;
}

export function CreditBalanceCard({
  balance,
  paused,
  pausedReason,
  onAddCredits,
}: CreditBalanceCardProps) {
  const totalDollars = (balance.totalCents / 100).toFixed(2);
  const freeDollars = (balance.freeCreditsRemaining / 100).toFixed(2);
  const paidDollars = (balance.paidCredits / 100).toFixed(2);

  const isLowBalance = balance.totalCents < 1000; // Less than $10

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-lg font-semibold">Credit Balance</h2>
        <button
          onClick={onAddCredits}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          Add Credits
        </button>
      </div>

      {paused && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="font-medium">Billing Paused</span>
          </div>
          {pausedReason && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {pausedReason}
            </p>
          )}
        </div>
      )}

      {isLowBalance && !paused && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="font-medium">Low Balance Warning</span>
          </div>
          <p className="mt-1 text-sm text-yellow-600 dark:text-yellow-300">
            Your balance is running low. Add credits to continue using workers.
          </p>
        </div>
      )}

      <div className="text-center py-4">
        <div className="text-4xl font-bold text-green-600 dark:text-green-400">
          ${totalDollars}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Available Credits
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Free Credits
          </p>
          <p className="text-lg font-semibold">${freeDollars}</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Paid Credits
          </p>
          <p className="text-lg font-semibold">${paidDollars}</p>
        </div>
      </div>
    </div>
  );
}
