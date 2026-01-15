import { useState, useEffect } from "react";
import { useAuthStore } from "../store/auth-store";

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

export default function Billing() {
  const tokens = useAuthStore((state) => state.tokens);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

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
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
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
