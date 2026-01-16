import { useState, useEffect } from "react";
import { useAuthStore } from "../store/auth-store";
import { BillingSkeleton, CostBreakdownSkeleton } from "../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  BillingErrorFallback,
} from "../components/ErrorBoundary";

interface Plan {
  id: string;
  name: string;
  price: number | null;
  taskQuota: number;
  userLimit: number;
  features: string[];
}

interface BillingStatus {
  plan: string;
  usage: {
    tasks: number;
    quota: number;
    percent: number;
    isUnlimited: boolean;
  };
  billing: {
    customerId: string | null;
    subscriptionId: string | null;
    subscriptionStatus: string | null;
    billingCycleStart: string | null;
    hasPaymentMethod: boolean;
  };
  stripeConfigured: boolean;
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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(
    null
  );
  const [costBreakdownLoading, setCostBreakdownLoading] = useState(true);
  const [costBreakdownError, setCostBreakdownError] = useState<string | null>(
    null
  );

  useEffect(() => {
    fetchData();
  }, [tokens]);

  async function fetchData() {
    try {
      const [plansRes, statusRes] = await Promise.all([
        fetch("/api/billing/plans", {
          headers: { Authorization: `Bearer ${tokens?.accessToken}` },
        }),
        fetch("/api/billing/status", {
          headers: { Authorization: `Bearer ${tokens?.accessToken}` },
        }),
      ]);

      if (plansRes.ok) {
        const data = await plansRes.json();
        setPlans(data.plans);
      }

      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch billing data:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCostBreakdown();
  }, [tokens]);

  async function fetchCostBreakdown() {
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
  }

  function formatTokenCount(tokens: number | null | undefined): string {
    if (tokens == null) return "0";
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(0)}K`;
    }
    return tokens.toString();
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

  async function handleUpgrade(planId: string) {
    setUpgrading(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ plan: planId }),
      });

      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      } else {
        const error = await res.json();
        alert(error.error || "Failed to start checkout");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Failed to start checkout");
    } finally {
      setUpgrading(null);
    }
  }

  async function handleManageBilling() {
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      } else {
        const error = await res.json();
        alert(error.error || "Failed to open billing portal");
      }
    } catch (error) {
      console.error("Portal error:", error);
      alert("Failed to open billing portal");
    }
  }

  if (loading) {
    return <BillingSkeleton />;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Billing & Usage</h1>

      {/* Current Usage */}
      {status && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Current Usage</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Plan</p>
              <p className="text-xl font-semibold capitalize">{status.plan}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Tasks This Month
              </p>
              <p className="text-xl font-semibold">
                {status.usage.isUnlimited
                  ? `${status.usage.tasks} (unlimited)`
                  : `${status.usage.tasks} / ${status.usage.quota}`}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
              <p className="text-xl font-semibold capitalize">
                {status.billing.subscriptionStatus || "Active"}
              </p>
            </div>
          </div>

          {!status.usage.isUnlimited && (
            <div className="mt-4">
              <div className="flex justify-between text-sm mb-1">
                <span>Usage</span>
                <span>{status.usage.percent}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    status.usage.percent > 90
                      ? "bg-red-500"
                      : status.usage.percent > 70
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min(status.usage.percent, 100)}%` }}
                ></div>
              </div>
            </div>
          )}

          {status.billing.customerId && (
            <button
              onClick={handleManageBilling}
              className="mt-4 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Manage Billing
            </button>
          )}
        </div>
      )}

      {/* Cost Breakdown */}
      <ErrorBoundaryWithRetry fallback={<BillingErrorFallback />}>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
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
              {/* Totals Row */}
            <div className="flex flex-wrap gap-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Total Spend
                </p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(costBreakdown.totals.cost)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Tasks</p>
                <p className="text-2xl font-bold">
                  {costBreakdown.totals.tasks}
                </p>
              </div>
            </div>

            {/* Token Usage */}
            <div className="py-4 border-b border-gray-200 dark:border-gray-700">
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

      {/* Pricing Plans */}
      <h2 className="text-lg font-semibold mb-4">Available Plans</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`bg-white dark:bg-gray-800 rounded-lg shadow p-6 ${
              status?.plan === plan.id
                ? "ring-2 ring-blue-500"
                : ""
            }`}
          >
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="text-2xl font-bold mt-2">
              {plan.price === null
                ? "Custom"
                : plan.price === 0
                  ? "Free"
                  : `$${plan.price}/mo`}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {plan.taskQuota === -1
                ? "Unlimited tasks"
                : `${plan.taskQuota} tasks/month`}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {plan.userLimit === -1
                ? "Unlimited users"
                : `${plan.userLimit} users`}
            </p>

            <ul className="mt-4 space-y-2">
              {plan.features.map((feature, i) => (
                <li key={i} className="text-sm flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-6">
              {status?.plan === plan.id ? (
                <span className="block text-center py-2 text-sm text-gray-500">
                  Current Plan
                </span>
              ) : plan.id === "free" ? (
                <span className="block text-center py-2 text-sm text-gray-500">
                  —
                </span>
              ) : plan.id === "enterprise" ? (
                <a
                  href="mailto:sales@workermill.com"
                  className="block text-center py-2 px-4 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-sm"
                >
                  Contact Sales
                </a>
              ) : (
                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={upgrading === plan.id || !status?.stripeConfigured}
                  className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {upgrading === plan.id ? "Loading..." : "Upgrade"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!status?.stripeConfigured && (
        <p className="mt-4 text-sm text-yellow-600 dark:text-yellow-400">
          Stripe is not configured. Contact your administrator to enable billing.
        </p>
      )}
    </div>
  );
}
