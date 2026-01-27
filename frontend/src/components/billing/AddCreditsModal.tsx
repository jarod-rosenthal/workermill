import { useState } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ""
);

interface PaymentMethod {
  id: string;
  brand: string;
  lastFour: string;
}

interface AddCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultPaymentMethod: PaymentMethod | null;
  processDeposit: (
    amountCents: number,
    paymentMethodId?: string
  ) => Promise<{ clientSecret?: string; success?: boolean }>;
}

const PRESET_AMOUNTS = [10, 25, 50, 100];

function AddCreditsForm({
  onClose,
  onSuccess,
  defaultPaymentMethod,
  processDeposit,
}: Omit<AddCreditsModalProps, "isOpen">) {
  const stripe = useStripe();
  const elements = useElements();
  const [amount, setAmount] = useState(25);
  const [customAmount, setCustomAmount] = useState("");
  const [useNewCard, setUseNewCard] = useState(!defaultPaymentMethod);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = customAmount ? parseFloat(customAmount) : amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (effectiveAmount < 10) {
      setError("Minimum deposit is $10");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const amountCents = Math.round(effectiveAmount * 100);

      if (useNewCard || !defaultPaymentMethod) {
        // Pay with new card
        if (!stripe || !elements) {
          setError("Payment system not ready");
          return;
        }

        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          setError("Card input not ready");
          return;
        }

        // Create payment method first
        const { error: pmError, paymentMethod } =
          await stripe.createPaymentMethod({
            type: "card",
            card: cardElement,
          });

        if (pmError) {
          setError(pmError.message || "Failed to process card");
          return;
        }

        // Process deposit with new payment method
        const result = await processDeposit(amountCents, paymentMethod.id);

        if (result.clientSecret) {
          // Need to confirm the payment
          const { error: confirmError } = await stripe.confirmCardPayment(
            result.clientSecret
          );
          if (confirmError) {
            setError(confirmError.message || "Payment failed");
            return;
          }
        }
      } else {
        // Pay with saved card
        const result = await processDeposit(
          amountCents,
          defaultPaymentMethod.id
        );

        if (result.clientSecret && stripe) {
          const { error: confirmError } = await stripe.confirmCardPayment(
            result.clientSecret
          );
          if (confirmError) {
            setError(confirmError.message || "Payment failed");
            return;
          }
        }
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add credits");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Amount Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Select Amount
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

      {/* Payment Method Selection */}
      {defaultPaymentMethod && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Payment Method
          </label>
          <div className="space-y-2">
            <label
              className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                !useNewCard
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-900/30"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                checked={!useNewCard}
                onChange={() => setUseNewCard(false)}
                className="mr-3"
              />
              <span className="capitalize">{defaultPaymentMethod.brand}</span>
              <span className="ml-2 text-gray-500">
                •••• {defaultPaymentMethod.lastFour}
              </span>
            </label>
            <label
              className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                useNewCard
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-900/30"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                checked={useNewCard}
                onChange={() => setUseNewCard(true)}
                className="mr-3"
              />
              <span>Use a new card</span>
            </label>
          </div>
        </div>
      )}

      {/* New Card Input */}
      {(useNewCard || !defaultPaymentMethod) && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Card Details
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
      )}

      {/* Summary */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-gray-600 dark:text-gray-400">Total Charge</span>
          <span className="text-xl font-bold">
            ${effectiveAmount.toFixed(2)}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Credits will be added to your account immediately
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={processing}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={processing || effectiveAmount < 10}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {processing ? "Processing..." : `Add $${effectiveAmount.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}

export function AddCreditsModal({
  isOpen,
  onClose,
  onSuccess,
  defaultPaymentMethod,
  processDeposit,
}: AddCreditsModalProps) {
  if (!isOpen) return null;

  const options: StripeElementsOptions = {
    appearance: {
      theme: "stripe",
    },
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Add Credits</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <Elements stripe={stripePromise} options={options}>
            <AddCreditsForm
              onClose={onClose}
              onSuccess={onSuccess}
              defaultPaymentMethod={defaultPaymentMethod}
              processDeposit={processDeposit}
            />
          </Elements>
        </div>
      </div>
    </div>
  );
}
