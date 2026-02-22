/**
 * Email Service - Barrel Re-exports
 *
 * All public functions are re-exported here for backwards compatibility.
 * External consumers import from "../services/email.js" which resolves to this directory index.
 */

export { sendInviteEmail, sendOrgAddedEmail } from "./invite-emails.js";
export { sendWelcomeEmail } from "./welcome-emails.js";
export {
  sendTaskCompletedEmail,
  sendTaskFailedEmail,
  sendCostAlertEmail,
  sendPrCreatedEmail,
} from "./task-emails.js";
export {
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendLowBalanceEmail,
  sendAutoRechargeSuccessEmail,
} from "./billing-emails.js";
export { sendTrialReminderEmail } from "./trial-emails.js";
export { sendSupportTicketEmail } from "./support-emails.js";
export {
  verifySESConfiguration,
  sendTestEmail,
  cleanupOldEmailLogs,
} from "./test-emails.js";
export {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe.js";
