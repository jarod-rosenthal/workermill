import { useState } from "react";

interface PaymentMethod {
  id: string;
  brand: string;
  lastFour: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface PaymentMethodListProps {
  paymentMethods: PaymentMethod[];
  onAddCard: () => void;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
}

function getCardIcon(brand: string) {
  const brandLower = brand.toLowerCase();

  if (brandLower === "visa") {
    return (
      <svg className="w-8 h-6" viewBox="0 0 48 32" fill="none">
        <rect width="48" height="32" rx="4" fill="#1A1F71" />
        <path
          d="M18.5 21.5L20.3 10.5H23.3L21.5 21.5H18.5ZM29.5 10.7C28.9 10.5 27.9 10.2 26.7 10.2C23.7 10.2 21.6 11.8 21.6 14.1C21.6 15.8 23.1 16.7 24.3 17.3C25.5 17.9 25.9 18.3 25.9 18.8C25.9 19.6 24.9 20 24 20C22.8 20 22.1 19.8 21.1 19.4L20.7 19.2L20.3 21.8C21.1 22.1 22.5 22.4 24 22.5C27.2 22.5 29.3 20.9 29.3 18.5C29.3 17.1 28.4 16.1 26.6 15.2C25.5 14.6 24.8 14.2 24.8 13.6C24.8 13.1 25.4 12.5 26.6 12.5C27.6 12.5 28.4 12.7 29 13L29.3 13.1L29.5 10.7ZM35.6 10.5H33.3C32.5 10.5 31.9 10.7 31.6 11.6L27.1 21.5H30.3L30.9 19.8H34.8L35.2 21.5H38L35.6 10.5ZM31.8 17.5C32.1 16.7 33.2 13.9 33.2 13.9C33.2 13.9 33.5 13.1 33.7 12.6L33.9 13.8C33.9 13.8 34.6 17.1 34.8 17.5H31.8ZM16.8 10.5L13.8 18.1L13.5 16.7C12.9 14.8 11.1 12.7 9.1 11.7L11.8 21.5H15L20 10.5H16.8Z"
          fill="white"
        />
        <path
          d="M11.4 10.5H6.1L6 10.8C9.8 11.8 12.4 14.3 13.5 17.3L12.3 11.6C12.1 10.8 11.5 10.5 11.4 10.5Z"
          fill="#F9A533"
        />
      </svg>
    );
  }

  if (brandLower === "mastercard") {
    return (
      <svg className="w-8 h-6" viewBox="0 0 48 32" fill="none">
        <rect width="48" height="32" rx="4" fill="#252525" />
        <circle cx="18" cy="16" r="8" fill="#EB001B" />
        <circle cx="30" cy="16" r="8" fill="#F79E1B" />
        <path
          d="M24 10.5C25.9 12 27.1 14.4 27.1 17C27.1 19.6 25.9 22 24 23.5C22.1 22 20.9 19.6 20.9 17C20.9 14.4 22.1 12 24 10.5Z"
          fill="#FF5F00"
        />
      </svg>
    );
  }

  if (brandLower === "amex" || brandLower === "american express") {
    return (
      <svg className="w-8 h-6" viewBox="0 0 48 32" fill="none">
        <rect width="48" height="32" rx="4" fill="#016FD0" />
        <path
          d="M10 16L13 10H16L19 16H16.5L16 15H13L12.5 16H10ZM13.5 13.5H15.5L14.5 11.5L13.5 13.5Z"
          fill="white"
        />
        <path d="M20 10H23V11H21V12H23V13H21V15H23V16H20V10Z" fill="white" />
        <path
          d="M24 10H27L28.5 13L30 10H33V16H31V12L29 16H28L26 12V16H24V10Z"
          fill="white"
        />
        <path
          d="M34 10H37V11H35V12H37V13H35V15H37V16H34V10Z"
          fill="white"
        />
      </svg>
    );
  }

  // Default card icon
  return (
    <svg
      className="w-8 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <rect
        x="1"
        y="4"
        width="22"
        height="16"
        rx="2"
        strokeWidth="2"
        fill="none"
      />
      <path strokeLinecap="round" strokeWidth="2" d="M1 10h22" />
    </svg>
  );
}

export function PaymentMethodList({
  paymentMethods,
  onAddCard,
  onDelete,
  onSetDefault,
}: PaymentMethodListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    setSettingDefaultId(id);
    try {
      await onSetDefault(id);
    } finally {
      setSettingDefaultId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Payment Methods</h2>
        <button
          onClick={onAddCard}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          Add Card
        </button>
      </div>

      {paymentMethods.length === 0 ? (
        <div className="text-center py-8">
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
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            />
          </svg>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            No payment methods added
          </p>
          <button
            onClick={onAddCard}
            className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Add your first card
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {paymentMethods.map((method) => (
            <div
              key={method.id}
              className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div className="flex items-center gap-4">
                {getCardIcon(method.brand)}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">
                      {method.brand}
                    </span>
                    <span className="text-gray-500">
                      •••• {method.lastFour}
                    </span>
                    {method.isDefault && (
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expires {method.expMonth.toString().padStart(2, "0")}/
                    {method.expYear}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!method.isDefault && (
                  <button
                    onClick={() => handleSetDefault(method.id)}
                    disabled={settingDefaultId === method.id}
                    className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    {settingDefaultId === method.id
                      ? "Setting..."
                      : "Set Default"}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(method.id)}
                  disabled={deletingId === method.id || method.isDefault}
                  className="px-3 py-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                  title={
                    method.isDefault ? "Cannot delete default card" : undefined
                  }
                >
                  {deletingId === method.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
