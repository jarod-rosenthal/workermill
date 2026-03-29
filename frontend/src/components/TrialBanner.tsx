import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, X, ArrowRight } from "lucide-react";
import { useAuthStore } from "../store/auth-store";

export function TrialBanner() {
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const organization = useAuthStore((state) => state.organization);

  if (dismissed || !organization) return null;

  const { plan, trialExpiresAt, stripeSubscriptionStatus } = organization;

  // Only show for Pro plan users without an active subscription who have a trial
  if (plan !== "pro" || stripeSubscriptionStatus === "active" || !trialExpiresAt) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(trialExpiresAt);
  const msRemaining = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  // Only show when 14 days or fewer remaining
  if (daysRemaining > 14) return null;

  const expired = daysRemaining <= 0;

  let borderColor: string;
  let bgColor: string;
  let iconColor: string;
  let textColor: string;
  let message: string;

  if (expired) {
    borderColor = "border-red-500/30";
    bgColor = "bg-red-500/10";
    iconColor = "text-red-500";
    textColor = "text-red-400";
    message = "Your trial period has expired";
  } else if (daysRemaining <= 3) {
    borderColor = "border-red-500/30";
    bgColor = "bg-red-500/10";
    iconColor = "text-red-500";
    textColor = "text-red-400";
    message = `Your trial period ends in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}!`;
  } else if (daysRemaining <= 7) {
    borderColor = "border-amber-500/30";
    bgColor = "bg-amber-500/10";
    iconColor = "text-amber-500";
    textColor = "text-amber-400";
    message = `Your trial period ends in ${daysRemaining} days`;
  } else {
    borderColor = "border-blue-500/30";
    bgColor = "bg-blue-500/10";
    iconColor = "text-blue-500";
    textColor = "text-blue-400";
    message = `Your trial period ends in ${daysRemaining} days`;
  }

  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl p-4 mb-6`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Clock className={`w-5 h-5 ${iconColor} flex-shrink-0`} />
          <div className="flex items-center gap-4 flex-1">
            <p className={`text-sm font-medium ${textColor}`}>{message}</p>
            <button
              onClick={() => navigate("/billing")}
              className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors whitespace-nowrap"
            >
              Subscribe Now
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
