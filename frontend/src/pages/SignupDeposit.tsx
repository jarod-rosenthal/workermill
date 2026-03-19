import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import axios from "axios";
import { useAuthStore } from "../store/auth-store";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ""
);

const PRESET_AMOUNTS = [10, 25, 50, 100];

function SignupDepositForm() {
  const navigate = useNavigate();
  const stripe = useStripe();
  const elements = useElements();
  const tokens = useAuthStore((state) => state.tokens);

  const [amount, setAmount] = useState(25);
  const [customAmount, setCustomAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = customAmount ? parseFloat(customAmount) : amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (effectiveAmount < 10) {
      setError("Minimum deposit is $10");
      return;
    }

    if (!stripe || !elements) {
      setError("Payment system not ready");
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError("Card input not ready");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Create payment method
      const { error: pmError, paymentMethod } =
        await stripe.createPaymentMethod({
          type: "card",
          card: cardElement,
        });

      if (pmError) {
        setError(pmError.message || "Failed to process card");
        return;
      }

      // Process the signup deposit
      const amountCents = Math.round(effectiveAmount * 100);
      const response = await axios.post(
        "/api/billing/deposit",
        {
          amountCents,
          paymentMethodId: paymentMethod.id,
        },
        {
          headers: { Authorization: `Bearer ${tokens?.accessToken}` },
        }
      );

      // If we got a client secret, we need to confirm the payment
      if (response.data.clientSecret) {
        const { error: confirmError } = await stripe.confirmCardPayment(
          response.data.clientSecret
        );

        if (confirmError) {
          setError(confirmError.message || "Payment failed");
          return;
        }
      }

      // Success! Navigate to dashboard
      navigate("/dashboard");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || "Failed to process payment");
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleSkip = () => {
    // Allow users to skip for now and go to dashboard
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            WorkerMill
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Set up your billing to start using AI workers
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {/* Bonus Banner */}
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <svg
                  className="w-8 h-8 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-green-700 dark:text-green-400">
                  $10 Free Credits!
                </p>
                <p className="text-sm text-green-600 dark:text-green-300">
                  Added to your account with your first deposit
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Amount Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Initial Deposit Amount
              </label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAmount(preset);
                      setCustomAmount("");
                    }}
                    className={`py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${
                      amount === preset && !customAmount
                        ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
                    }`}
                  >
                    ${preset}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  $
                </span>
                <input
                  type="number"
                  min="10"
                  step="1"
                  placeholder="Custom amount"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full pl-7 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Minimum deposit: $10
              </p>
            </div>

            {/* Card Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Payment Method
              </label>
              <div className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                <CardElement
                  options={{
                    style: {
                      base: {
                        fontSize: "16px",
                        color: "#1f2937",
                        "::placeholder": {
                          color: "#9ca3af",
                        },
                      },
                      invalid: {
                        color: "#ef4444",
                      },
                    },
                  }}
                />
              </div>
            </div>

            {/* Summary */}
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    Deposit
                  </span>
                  <span>${effectiveAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                  <span>Free Credits Bonus</span>
                  <span>+$10.00</span>
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between font-semibold">
                    <span>Starting Balance</span>
                    <span className="text-green-600 dark:text-green-400">
                      ${(effectiveAmount + 10).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={processing || effectiveAmount < 10}
              className="w-full py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {processing
                ? "Processing..."
                : `Pay $${effectiveAmount.toFixed(2)} & Get Started`}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={handleSkip}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Skip for now
            </button>
          </div>

          {/* Footer */}
          <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
            Your card details are securely processed by Stripe. We charge a 15%
            fee on AI usage costs.{" "}
            <a href="/" className="text-blue-600 hover:underline">
              Learn more
            </a>
          </p>
        </div>

        {/* How it works */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="font-semibold mb-4">How Billing Works</h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium">
                1
              </div>
              <div>
                <p className="font-medium text-sm">Add Credits</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Prepay for AI usage with credit deposits
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium">
                2
              </div>
              <div>
                <p className="font-medium text-sm">Use AI Workers</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Pay only for what you use (AI cost + 15% fee)
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium">
                3
              </div>
              <div>
                <p className="font-medium text-sm">Auto-Recharge</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Set up automatic top-ups so you never run out
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupDeposit() {
  const options: StripeElementsOptions = {
    appearance: {
      theme: "stripe",
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <SignupDepositForm />
    </Elements>
  );
}
