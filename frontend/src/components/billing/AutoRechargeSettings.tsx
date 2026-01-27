import { useState, useEffect } from "react";

interface AutoRechargeSettings {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}

interface AutoRechargeSettingsProps {
  settings: AutoRechargeSettings;
  hasPaymentMethod: boolean;
  onUpdate: (settings: AutoRechargeSettings) => Promise<void>;
}

export function AutoRechargeSettingsCard({
  settings,
  hasPaymentMethod,
  onUpdate,
}: AutoRechargeSettingsProps) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [threshold, setThreshold] = useState(settings.thresholdCents / 100);
  const [amount, setAmount] = useState(settings.amountCents / 100);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(settings.enabled);
    setThreshold(settings.thresholdCents / 100);
    setAmount(settings.amountCents / 100);
  }, [settings]);

  const handleSave = async () => {
    if (!hasPaymentMethod && enabled) {
      setError("Add a payment method before enabling auto-recharge");
      return;
    }

    if (threshold < 5) {
      setError("Threshold must be at least $5");
      return;
    }

    if (amount < 10) {
      setError("Recharge amount must be at least $10");
      return;
    }

    if (amount <= threshold) {
      setError("Recharge amount must be greater than threshold");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      await onUpdate({
        enabled,
        thresholdCents: Math.round(threshold * 100),
        amountCents: Math.round(amount * 100),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    enabled !== settings.enabled ||
    Math.round(threshold * 100) !== settings.thresholdCents ||
    Math.round(amount * 100) !== settings.amountCents;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Auto-Recharge</h2>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm ${enabled ? "text-green-600 dark:text-green-400" : "text-gray-500"}`}
          >
            {enabled ? "Active" : "Disabled"}
          </span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
            }`}
            disabled={!hasPaymentMethod}
            title={!hasPaymentMethod ? "Add a payment method first" : undefined}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {!hasPaymentMethod && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-700 dark:text-yellow-400">
            Add a payment method to enable auto-recharge.
          </p>
        </div>
      )}

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Automatically add credits when your balance runs low.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            When balance drops below
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              min="5"
              step="5"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
              disabled={!enabled}
              className="w-full pl-7 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Recharge amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              min="10"
              step="10"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              disabled={!enabled}
              className="w-full pl-7 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {hasChanges && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

      {enabled && hasPaymentMethod && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            When your balance falls to ${threshold.toFixed(2)} or below, we'll
            automatically charge ${amount.toFixed(2)} to your default payment
            method.
          </p>
        </div>
      )}
    </div>
  );
}
