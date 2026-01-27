import { useState } from "react";

interface Transaction {
  id: string;
  type: "deposit" | "usage" | "refund" | "bonus" | "auto_recharge";
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  aiCostCents: number | null;
  feeCents: number | null;
  createdAt: string;
}

interface TransactionHistoryProps {
  transactions: Transaction[];
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

function getTypeBadge(type: Transaction["type"]) {
  const styles: Record<Transaction["type"], string> = {
    deposit: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    usage: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    refund: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    bonus: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    auto_recharge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };

  const labels: Record<Transaction["type"], string> = {
    deposit: "Deposit",
    usage: "Usage",
    refund: "Refund",
    bonus: "Bonus",
    auto_recharge: "Auto-Recharge",
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${styles[type]}`}>
      {labels[type]}
    </span>
  );
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatCurrency(cents: number) {
  const prefix = cents >= 0 ? "+" : "";
  return `${prefix}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function TransactionHistory({
  transactions,
  totalCount,
  page,
  pageSize,
  onPageChange,
  loading = false,
}: TransactionHistoryProps) {
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold">Transaction History</h2>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="mt-2 text-gray-500">Loading transactions...</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            No transactions yet
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-900/50"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(tx.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getTypeBadge(tx.type)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                      <div>{tx.description || "-"}</div>
                      {tx.type === "usage" && tx.aiCostCents && tx.feeCents && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          AI: ${(tx.aiCostCents / 100).toFixed(2)} + Fee: $
                          {(tx.feeCents / 100).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-right ${
                        tx.amountCents >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCurrency(tx.amountCents)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100">
                      ${(tx.balanceAfterCents / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
            {transactions.map((tx) => (
              <div key={tx.id} className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    {getTypeBadge(tx.type)}
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(tx.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-medium ${
                        tx.amountCents >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCurrency(tx.amountCents)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Balance: ${(tx.balanceAfterCents / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
                {tx.description && (
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    {tx.description}
                  </p>
                )}
                {tx.type === "usage" && tx.aiCostCents && tx.feeCents && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    AI: ${(tx.aiCostCents / 100).toFixed(2)} + Fee: $
                    {(tx.feeCents / 100).toFixed(2)}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Showing {(page - 1) * pageSize + 1} -{" "}
                {Math.min(page * pageSize, totalCount)} of {totalCount}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
