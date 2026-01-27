import { useState, useEffect } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";

// Initialize Stripe - the key should be loaded from environment
const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ""
);

interface AddCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  getSetupIntent: () => Promise<{ clientSecret: string }>;
  savePaymentMethod: (paymentMethodId: string) => Promise<void>;
}

function AddCardForm({
  onClose,
  onSuccess,
  getSetupIntent,
  savePaymentMethod,
}: Omit<AddCardModalProps, "isOpen">) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    const fetchSetupIntent = async () => {
      try {
        const { clientSecret: secret } = await getSetupIntent();
        setClientSecret(secret);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to initialize payment"
        );
      }
    };
    fetchSetupIntent();
  }, [getSetupIntent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || !clientSecret) {
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const { error: stripeError, setupIntent } =
        await stripe.confirmCardSetup(clientSecret, {
          payment_method: {
            card: cardElement,
          },
        });

      if (stripeError) {
        setError(stripeError.message || "Failed to add card");
        return;
      }

      if (
        setupIntent?.status === "succeeded" &&
        setupIntent.payment_method
      ) {
        // Save the payment method to our backend
        await savePaymentMethod(setupIntent.payment_method as string);
        onSuccess();
      } else {
        setError("Failed to save card. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add card");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
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
                  color: "***REMOVED***1f2937",
                  "::placeholder": {
                    color: "***REMOVED***9ca3af",
                  },
                },
                invalid: {
                  color: "***REMOVED***ef4444",
                },
              },
            }}
          />
        </div>
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
          disabled={!stripe || processing || !clientSecret}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {processing ? "Adding..." : "Add Card"}
        </button>
      </div>
    </form>
  );
}

export function AddCardModal({
  isOpen,
  onClose,
  onSuccess,
  getSetupIntent,
  savePaymentMethod,
}: AddCardModalProps) {
  if (!isOpen) return null;

  const options: StripeElementsOptions = {
    appearance: {
      theme: "stripe",
    },
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Add Payment Method</h3>
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
            <AddCardForm
              onClose={onClose}
              onSuccess={onSuccess}
              getSetupIntent={getSetupIntent}
              savePaymentMethod={savePaymentMethod}
            />
          </Elements>

          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
            Your card details are securely processed by Stripe. We never store
            your full card number.
          </p>
        </div>
      </div>
    </div>
  );
}
