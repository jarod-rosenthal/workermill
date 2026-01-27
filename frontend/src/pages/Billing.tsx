import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "../store/auth-store";
import { BillingSkeleton, CostBreakdownSkeleton } from "../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  BillingErrorFallback,
} from "../components/ErrorBoundary";
import { CreditBalanceCard } from "../components/billing/CreditBalanceCard";
import { AutoRechargeSettingsCard } from "../components/billing/AutoRechargeSettings";
import { PaymentMethodList } from "../components/billing/PaymentMethodList";
import { AddCardModal } from "../components/billing/AddCardModal";
import { AddCreditsModal } from "../components/billing/AddCreditsModal";
import { TransactionHistory } from "../components/billing/TransactionHistory";

interface CreditBalance {
  totalCents: number;
  freeCreditsRemaining: number;
  paidCredits: number;
}

interface AutoRechargeSettings {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}

interface PaymentMethod {
  id: string;
  brand: string;
  lastFour: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface BillingStatus {
  balance: CreditBalance;
  autoRecharge: AutoRechargeSettings;
  paymentMethods: PaymentMethod[];
  status: {
    paused: boolean;
    pausedReason: string | null;
    depositCompleted: boolean;
  };
  thisMonth: {
    aiCostCents: number;
    feeCents: number;
    taskCount: number;
  };
  stripeConfigured: boolean;
}

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

interface CostBreakdown {
  period: { start: string; end: string };
  totals: {
    cost: number | null;
    tasks: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheTokens: number | null;
  };
  byModel: Array<{ model: string; cost: number | null; tasks: number }>;
  byPersona: Array<{ persona: string; cost: number | null; tasks: number }>;
}

export default function Billing() {
  const tokens = useAuthStore((state) => state.tokens);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsTotal, setTransactionsTotal] = useState(0);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [costBreakdownLoading, setCostBreakdownLoading] = useState(true);
  const [costBreakdownError, setCostBreakdownError] = useState<string | null>(null);

  // Modal states
  const [showAddCard, setShowAddCard] = useState(false);
  const [showAddCredits, setShowAddCredits] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch("/api/billing/credit-status", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch billing status:", error);
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchTransactions = useCallback(
    async (page: number) => {
      if (!tokens?.accessToken) return;
      setTransactionsLoading(true);
      try {
        const limit = 10;
        const offset = (page - 1) * limit;
        const res = await fetch(
          `/api/billing/transactions?limit=${limit}&offset=${offset}`,
          {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          }
        );
        if (res.ok) {
          const data = await res.json();
          setTransactions(data.transactions);
          setTransactionsTotal(data.total);
        }
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
      } finally {
        setTransactionsLoading(false);
      }
    },
    [tokens?.accessToken]
  );

  const fetchCostBreakdown = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setCostBreakdownLoading(true);
    setCostBreakdownError(null);
    try {
      const res = await fetch("/api/billing/cost-breakdown", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCostBreakdown(data);
      } else {
        setCostBreakdownError("Failed to load cost breakdown");
      }
    } catch (error) {
      console.error("Failed to fetch cost breakdown:", error);
      setCostBreakdownError("Failed to load cost breakdown");
    } finally {
      setCostBreakdownLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    fetchStatus();
    fetchCostBreakdown();
  }, [fetchStatus, fetchCostBreakdown]);

  useEffect(() => {
    fetchTransactions(transactionsPage);
  }, [transactionsPage, fetchTransactions]);

  // API handlers
  const handleUpdateAutoRecharge = async (settings: AutoRechargeSettings) => {
    const res = await fetch("/api/billing/auto-recharge", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens?.accessToken}`,
      },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to update auto-recharge settings");
    }
    await fetchStatus();
  };

  const handleDeletePaymentMethod = async (id: string) => {
    const res = await fetch(`/api/billing/payment-methods/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokens?.accessToken}` },
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to remove payment method");
    }
    await fetchStatus();
  };

  const handleSetDefaultPaymentMethod = async (id: string) => {
    const res = await fetch(`/api/billing/payment-methods/${id}/default`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokens?.accessToken}` },
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to set default payment method");
    }
    await fetchStatus();
  };

  const getSetupIntent = async () => {
    const res = await fetch("/api/billing/setup-intent", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens?.accessToken}` },
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to create setup intent");
    }
    return res.json();
  };

  const savePaymentMethod = async (paymentMethodId: string) => {
    const res = await fetch("/api/billing/payment-methods", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens?.accessToken}`,
      },
      body: JSON.stringify({ paymentMethodId }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to save payment method");
    }
  };

  const processDeposit = async (amountCents: number, paymentMethodId?: string) => {
    const res = await fetch("/api/billing/deposit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens?.accessToken}`,
      },
      body: JSON.stringify({ amountCents, paymentMethodId }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to process deposit");
    }
    return res.json();
  };

  const handleRetryPayment = async () => {
    const res = await fetch("/api/billing/retry-payment", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens?.accessToken}` },
    });
    if (!res.ok) {
      const error = await res.json();
      alert(error.error || "Failed to retry payment");
      return;
    }
    await fetchStatus();
  };

  function formatTokenCount(tokenCount: number | null | undefined): string {
    if (tokenCount == null) return "0";
    if (tokenCount >= 1_000_000) {
      return `${(tokenCount / 1_000_000).toFixed(1)}M`;
    }
    if (tokenCount >= 1_000) {
      return `${(tokenCount / 1_000).toFixed(0)}K`;
    }
    return tokenCount.toString();
  }

  function formatCurrency(amount: number | null | undefined): string {
    if (amount == null) return "$0.00";
    return `$${amount.toFixed(2)}`;
  }

  function formatModelName(model: string): string {
    if (model.includes("haiku")) return "Haiku";
    if (model.includes("sonnet")) return "Sonnet";
    if (model.includes("opus")) return "Opus";
    return model;
  }

  function formatPersonaName(persona: string): string {
    return persona
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  if (loading) {
    return <BillingSkeleton />;
  }

  if (!status) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Billing</h1>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center">
          <p className="text-gray-500">Unable to load billing information.</p>
          <button
            onClick={() => fetchStatus()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const defaultPaymentMethod = status.paymentMethods?.find((pm) => pm.isDefault) ?? null;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Billing</h1>

      {/* Success Message */}
      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-3">
            <svg
              className="w-5 h-5 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p className="text-green-700 dark:text-green-400 font-medium">
              {successMessage}
            </p>
          </div>
        </div>
      )}

      {/* Billing Paused Banner */}
      {status.status.paused && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6 text-red-600 dark:text-red-400"
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
              <div>
                <p className="font-semibold text-red-700 dark:text-red-400">
                  Billing Paused
                </p>
                <p className="text-sm text-red-600 dark:text-red-300">
                  {status.status.pausedReason ||
                    "Your workers are paused due to a billing issue."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRetryPayment}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700"
              >
                Retry Payment
              </button>
              <button
                onClick={() => setShowAddCard(true)}
                className="px-4 py-2 border border-red-600 text-red-600 text-sm font-medium rounded hover:bg-red-50 dark:hover:bg-red-900/30"
              >
                Add New Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Credit Balance */}
        <CreditBalanceCard
          balance={status.balance}
          paused={status.status.paused}
          pausedReason={status.status.pausedReason}
          onAddCredits={() => setShowAddCredits(true)}
        />

        {/* This Month's Usage */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">This Month's Usage</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">
                ${(status.thisMonth.aiCostCents / 100).toFixed(2)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                AI Spend
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                ${(status.thisMonth.feeCents / 100).toFixed(2)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Fee (15%)
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{status.thisMonth.taskCount}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Tasks</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Total</span>
              <span className="text-xl font-bold">
                $
                {(
                  (status.thisMonth.aiCostCents + status.thisMonth.feeCents) /
                  100
                ).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Auto-Recharge */}
        <AutoRechargeSettingsCard
          settings={status.autoRecharge}
          hasPaymentMethod={(status.paymentMethods?.length ?? 0) > 0}
          onUpdate={handleUpdateAutoRecharge}
        />

        {/* Payment Methods */}
        <PaymentMethodList
          paymentMethods={status.paymentMethods ?? []}
          onAddCard={() => setShowAddCard(true)}
          onDelete={handleDeletePaymentMethod}
          onSetDefault={handleSetDefaultPaymentMethod}
        />
      </div>

      {/* Cost Breakdown */}
      <ErrorBoundaryWithRetry fallback={<BillingErrorFallback />}>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            Cost Breakdown (This Month)
          </h2>

          {costBreakdownLoading ? (
            <CostBreakdownSkeleton />
          ) : costBreakdownError ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              {costBreakdownError}
            </div>
          ) : costBreakdown ? (
            <>
              {/* Token Usage */}
              <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Token Usage
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pl-4">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Input:</span>
                    <span className="font-medium">
                      {formatTokenCount(costBreakdown.totals.inputTokens)} tokens
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Output:</span>
                    <span className="font-medium">
                      {formatTokenCount(costBreakdown.totals.outputTokens)} tokens
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Cache:</span>
                    <span className="font-medium">
                      {formatTokenCount(costBreakdown.totals.cacheTokens)} tokens
                    </span>
                  </div>
                </div>
              </div>

              {/* By Model and By Persona */}
              <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* By Model */}
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    By Model
                  </p>
                  <div className="space-y-2">
                    {costBreakdown.byModel.length > 0 ? (
                      costBreakdown.byModel.map((item) => (
                        <div
                          key={item.model}
                          className="flex justify-between items-center text-sm"
                        >
                          <span className="text-gray-600 dark:text-gray-400">
                            {formatModelName(item.model)}
                          </span>
                          <span className="font-medium">
                            {formatCurrency(item.cost)}{" "}
                            <span className="text-gray-400">
                              ({item.tasks} tasks)
                            </span>
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">No data</p>
                    )}
                  </div>
                </div>

                {/* By Persona */}
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    By Persona
                  </p>
                  <div className="space-y-2">
                    {costBreakdown.byPersona.length > 0 ? (
                      costBreakdown.byPersona.map((item) => (
                        <div
                          key={item.persona}
                          className="flex justify-between items-center text-sm"
                        >
                          <span className="text-gray-600 dark:text-gray-400">
                            {formatPersonaName(item.persona)}
                          </span>
                          <span className="font-medium">
                            {formatCurrency(item.cost)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">No data</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No cost data available
            </div>
          )}
        </div>
      </ErrorBoundaryWithRetry>

      {/* Transaction History */}
      <TransactionHistory
        transactions={transactions}
        totalCount={transactionsTotal}
        page={transactionsPage}
        pageSize={10}
        onPageChange={setTransactionsPage}
        loading={transactionsLoading}
      />

      {/* Modals */}
      <AddCardModal
        isOpen={showAddCard}
        onClose={() => setShowAddCard(false)}
        onSuccess={() => {
          setShowAddCard(false);
          fetchStatus();
        }}
        getSetupIntent={getSetupIntent}
        savePaymentMethod={savePaymentMethod}
      />

      <AddCreditsModal
        isOpen={showAddCredits}
        onClose={() => setShowAddCredits(false)}
        onSuccess={() => {
          setShowAddCredits(false);
          setSuccessMessage("Credits added successfully!");
          setTimeout(() => setSuccessMessage(null), 5000);
          fetchStatus();
          fetchTransactions(1);
        }}
        defaultPaymentMethod={
          defaultPaymentMethod
            ? {
                id: defaultPaymentMethod.id,
                brand: defaultPaymentMethod.brand,
                lastFour: defaultPaymentMethod.lastFour,
              }
            : null
        }
        processDeposit={processDeposit}
      />

      {!status.stripeConfigured && (
        <p className="mt-4 text-sm text-yellow-600 dark:text-yellow-400">
          Stripe is not configured. Contact your administrator to enable billing.
        </p>
      )}
    </div>
  );
}
