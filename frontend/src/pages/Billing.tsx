import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/auth-store";
import { BillingSkeleton } from "../components/ui/skeleton";
import {
  ErrorBoundaryWithRetry,
  BillingErrorFallback,
} from "../components/ErrorBoundary";
import { PaymentMethodList } from "../components/billing/PaymentMethodList";
import { AddCardModal } from "../components/billing/AddCardModal";
import { TransactionHistory } from "../components/billing/TransactionHistory";
import {
  ArrowLeft,
  Zap,
  Clock,
  Users,
  TrendingUp,
  Gift,
  Copy,
  CheckCircle,
  ExternalLink,
  Sparkles,
  ArrowRight,
  CreditCard,
  DollarSign,
  AlertTriangle,
  Calendar,
} from "lucide-react";

interface SubscriptionData {
  plan: {
    id: string;
    name: string;
    price: number;
    includedHours: number;
    userLimit: number;
    overageRate: number;
  };
  usage: {
    hoursUsed: number;
    hoursIncluded: number;
    hoursRemaining: number;
    overageHours: number;
    overageCost: number;
    percentUsed: number;
    isUnlimited: boolean;
  };
  billing: {
    periodStart: string;
    periodEnd: string;
    daysRemaining: number;
    nextInvoiceEstimate: number;
  };
  team: {
    memberCount: number;
    memberLimit: number;
  };
}

interface PaymentMethod {
  id: string;
  brand: string;
  lastFour: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface CreditStatus {
  paymentMethods: PaymentMethod[];
  status: {
    paused: boolean;
    pausedReason: string | null;
    depositCompleted: boolean;
  };
  stripeConfigured: boolean;
}

interface Transaction {
  id: string;
  type: "deposit" | "usage" | "refund" | "bonus" | "auto_recharge" | "referral_bonus";
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  aiCostCents: number | null;
  feeCents: number | null;
  createdAt: string;
}

interface Plan {
  id: string;
  name: string;
  price: number | null;
  includedHours: number;
  userLimit: number;
  features: string[];
  overageRate: number | null;
  highlighted?: boolean;
}

interface ReferralStats {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  pendingReferrals: number;
  qualifiedReferrals: number;
  creditedReferrals: number;
  totalCreditsEarned: number;
  totalCreditsEarnedFormatted: string;
  referralsThisYear: number;
  referralsRemaining: number;
}

interface ReferralDiscount {
  hasDiscount: boolean;
  discountPercent: number;
  monthsRemaining: number;
}

export default function Billing() {
  const tokens = useAuthStore((state) => state.tokens);
  const organization = useAuthStore((state) => state.organization);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsTotal, setTransactionsTotal] = useState(0);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralDiscount, setReferralDiscount] = useState<ReferralDiscount | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Modal states
  const [showAddCard, setShowAddCard] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch("/api/billing/subscription", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSubscription(data);
      }
    } catch (error) {
      console.error("Failed to fetch subscription:", error);
    }
  }, [tokens?.accessToken]);

  const fetchCreditStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch("/api/billing/credit-status", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCreditStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch credit status:", error);
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchPlans = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch("/api/billing/plans", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans);
      }
    } catch (error) {
      console.error("Failed to fetch plans:", error);
    }
  }, [tokens?.accessToken]);

  const fetchReferralStats = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch("/api/referrals/stats", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReferralStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch referral stats:", error);
    }
  }, [tokens?.accessToken]);

  const fetchReferralDiscount = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch("/api/referrals/discount", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReferralDiscount(data);
      }
    } catch (error) {
      console.error("Failed to fetch referral discount:", error);
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

  useEffect(() => {
    fetchSubscription();
    fetchCreditStatus();
    fetchPlans();
    fetchReferralStats();
    fetchReferralDiscount();
  }, [fetchSubscription, fetchCreditStatus, fetchPlans, fetchReferralStats, fetchReferralDiscount]);

  useEffect(() => {
    fetchTransactions(transactionsPage);
  }, [transactionsPage, fetchTransactions]);

  // API handlers
  const handleDeletePaymentMethod = async (id: string) => {
    const res = await fetch(`/api/billing/payment-methods/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokens?.accessToken}` },
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to remove payment method");
    }
    await fetchCreditStatus();
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
    await fetchCreditStatus();
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
    await fetchCreditStatus();
  };

  const handleManageSubscription = async () => {
    const res = await fetch("/api/billing/portal", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens?.accessToken}` },
    });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      const error = await res.json();
      alert(error.error || "Failed to open billing portal");
    }
  };

  const copyReferralCode = () => {
    if (referralStats?.referralLink) {
      navigator.clipboard.writeText(referralStats.referralLink);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  // Get next plan for upgrade prompt
  const nextPlan = plans.find((p) => {
    const planOrder = ["starter", "team", "business", "enterprise"];
    const currentIndex = planOrder.indexOf(subscription?.plan.id || "starter");
    return p.id === planOrder[currentIndex + 1];
  });

  // Get progress bar color based on usage
  const getProgressColor = (percent: number) => {
    if (percent >= 90) return "bg-red-500";
    if (percent >= 75) return "bg-amber-500";
    return "bg-green-500";
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return <BillingSkeleton />;
  }

  if (!subscription || !creditStatus) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto p-6">
          <div className="bg-card rounded-xl border border-border p-8 text-center">
            <p className="text-muted-foreground mb-4">Unable to load billing information.</p>
            <button
              onClick={() => {
                fetchSubscription();
                fetchCreditStatus();
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header with Navigation */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm font-medium">Back to Dashboard</span>
              </Link>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-primary" />
                <h1 className="text-xl font-bold text-foreground">Billing</h1>
              </div>
            </div>
            <Link
              to="/settings"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Settings
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Success Message */}
        {successMessage && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <p className="text-green-400 font-medium">{successMessage}</p>
            </div>
          </div>
        )}

        {/* Billing Paused Banner */}
        {creditStatus.status.paused && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-6 h-6 text-red-500" />
                <div>
                  <p className="font-semibold text-red-400">Billing Paused</p>
                  <p className="text-sm text-red-400/80">
                    {creditStatus.status.pausedReason || "Your workers are paused due to a billing issue."}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRetryPayment}
                  className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600"
                >
                  Retry Payment
                </button>
                <button
                  onClick={() => setShowAddCard(true)}
                  className="px-4 py-2 border border-red-500 text-red-400 text-sm font-medium rounded-lg hover:bg-red-500/10"
                >
                  Add New Card
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Referral Discount Banner */}
        {referralDiscount?.hasDiscount && (
          <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <div>
                <p className="font-semibold text-purple-300">
                  Referral Discount Active: {referralDiscount.discountPercent}% off
                </p>
                <p className="text-sm text-purple-300/80">
                  {referralDiscount.monthsRemaining} month{referralDiscount.monthsRemaining !== 1 ? "s" : ""} remaining
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Plan Hero Card */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-6 border-b border-border bg-gradient-to-r from-primary/5 to-cyan-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center">
                  <Zap className="w-8 h-8 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Current Plan</p>
                  <h2 className="text-3xl font-bold text-foreground">{subscription.plan.name}</h2>
                </div>
              </div>
              {subscription.plan.price > 0 && (
                <div className="text-right">
                  <p className="text-4xl font-bold text-foreground">${subscription.plan.price}</p>
                  <p className="text-sm text-muted-foreground">/month</p>
                </div>
              )}
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <Clock className="w-6 h-6 text-primary mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">
                  {subscription.plan.includedHours === -1 ? "Unlimited" : `${subscription.plan.includedHours}h`}
                </p>
                <p className="text-sm text-muted-foreground">Included Hours</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <Users className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">
                  {subscription.plan.userLimit === -1 ? "Unlimited" : subscription.plan.userLimit}
                </p>
                <p className="text-sm text-muted-foreground">Team Max</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <TrendingUp className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">
                  ${subscription.plan.overageRate}/hr
                </p>
                <p className="text-sm text-muted-foreground">Overage Rate</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex gap-3">
                {creditStatus.stripeConfigured && (
                  <button
                    onClick={handleManageSubscription}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 inline-flex items-center gap-2 text-sm font-medium"
                  >
                    <CreditCard className="w-4 h-4" />
                    {subscription.plan.price > 0 ? "Manage Subscription" : "Upgrade Plan"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Hours Usage & Billing Period - Two Column */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Hours Usage Card */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-foreground">Compute Hours</h3>
            </div>

            {subscription.usage.isUnlimited ? (
              <div className="text-center py-4">
                <p className="text-3xl font-bold text-foreground">
                  {subscription.usage.hoursUsed.toFixed(1)}h
                </p>
                <p className="text-sm text-muted-foreground">used this period</p>
                <p className="text-xs text-green-400 mt-2">Unlimited compute hours</p>
              </div>
            ) : (
              <>
                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">
                      {subscription.usage.hoursUsed.toFixed(1)}h / {subscription.usage.hoursIncluded}h used
                    </span>
                    <span className={`font-medium ${
                      subscription.usage.percentUsed >= 90 ? "text-red-400" :
                      subscription.usage.percentUsed >= 75 ? "text-amber-400" : "text-green-400"
                    }`}>
                      {subscription.usage.percentUsed.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getProgressColor(subscription.usage.percentUsed)}`}
                      style={{ width: `${Math.min(100, subscription.usage.percentUsed)}%` }}
                    />
                  </div>
                </div>

                {/* Overage Info */}
                <div className="space-y-2">
                  {subscription.usage.overageHours > 0 ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-400">Overage hours</span>
                        <span className="font-medium text-amber-400">
                          {subscription.usage.overageHours.toFixed(1)}h
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-400">Overage charges</span>
                        <span className="font-medium text-amber-400">
                          ${subscription.usage.overageCost.toFixed(2)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-green-400">
                      <CheckCircle className="w-4 h-4" />
                      <span>No overage charges</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Billing Period Card */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-foreground">Billing Period</h3>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {formatDate(subscription.billing.periodStart)} - {formatDate(subscription.billing.periodEnd)}
                </p>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Days remaining</span>
                <span className="font-medium text-foreground">{subscription.billing.daysRemaining} days</span>
              </div>

              <div className="pt-4 border-t border-border">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Invoice</span>
                  <span className="text-2xl font-bold text-foreground">
                    ${subscription.billing.nextInvoiceEstimate.toFixed(2)}
                  </span>
                </div>
                {subscription.usage.overageCost > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 text-right">
                    ${subscription.plan.price} base + ${subscription.usage.overageCost.toFixed(2)} overage
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Method & Team Members - Two Column */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Payment Methods */}
          <PaymentMethodList
            paymentMethods={creditStatus.paymentMethods ?? []}
            onAddCard={() => setShowAddCard(true)}
            onDelete={handleDeletePaymentMethod}
            onSetDefault={handleSetDefaultPaymentMethod}
          />

          {/* Team Members Card */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-foreground">Team Members</h3>
            </div>

            <div className="mb-4">
              <p className="text-3xl font-bold text-foreground">
                {subscription.team.memberCount}
                {subscription.team.memberLimit !== -1 && (
                  <span className="text-lg font-normal text-muted-foreground">
                    {" "}/ {subscription.team.memberLimit}
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {subscription.team.memberLimit === -1 ? "Unlimited members" : "members"}
              </p>
            </div>

            <Link
              to="/settings"
              className="px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted/50 inline-flex items-center gap-2 text-sm font-medium"
            >
              Manage Team
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Referral Program */}
        <ErrorBoundaryWithRetry fallback={<BillingErrorFallback />}>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-6 border-b border-border bg-gradient-to-r from-purple-500/5 to-pink-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Gift className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Referral Program</h2>
                  <p className="text-sm text-muted-foreground">
                    Earn $100 credit for each friend who subscribes
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6">
              {referralStats ? (
                <div className="space-y-6">
                  {/* Referral Link */}
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Your Referral Link
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={referralStats.referralLink}
                        readOnly
                        className="flex-1 px-4 py-2.5 rounded-lg bg-muted/50 border border-border text-foreground text-sm"
                      />
                      <button
                        onClick={copyReferralCode}
                        className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 inline-flex items-center gap-2 text-sm font-medium"
                      >
                        {copiedCode ? (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-muted/30 text-center">
                      <p className="text-2xl font-bold text-foreground">{referralStats.totalReferrals}</p>
                      <p className="text-sm text-muted-foreground">Total Referrals</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/30 text-center">
                      <p className="text-2xl font-bold text-foreground">{referralStats.pendingReferrals}</p>
                      <p className="text-sm text-muted-foreground">Pending</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/30 text-center">
                      <p className="text-2xl font-bold text-foreground">{referralStats.creditedReferrals}</p>
                      <p className="text-sm text-muted-foreground">Successful</p>
                    </div>
                    <div className="p-4 rounded-lg bg-green-500/10 text-center">
                      <p className="text-2xl font-bold text-green-400">
                        {referralStats.totalCreditsEarnedFormatted}
                      </p>
                      <p className="text-sm text-muted-foreground">Credits Earned</p>
                    </div>
                  </div>

                  {/* How it works */}
                  <div className="pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground mb-3">How it works:</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary">1</span>
                        </div>
                        <p className="text-muted-foreground">Share your referral link with friends</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary">2</span>
                        </div>
                        <p className="text-muted-foreground">They get 50% off their first 3 months</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary">3</span>
                        </div>
                        <p className="text-muted-foreground">You get $100 credit after their first paid month</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Loading referral information...</p>
                </div>
              )}
            </div>
          </div>
        </ErrorBoundaryWithRetry>

        {/* Invoice History */}
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
            fetchCreditStatus();
            setSuccessMessage("Payment method added successfully!");
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
          getSetupIntent={getSetupIntent}
          savePaymentMethod={savePaymentMethod}
        />

        {!creditStatus.stripeConfigured && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <p className="text-sm text-amber-400">
                Stripe is not configured. Contact your administrator to enable billing.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
