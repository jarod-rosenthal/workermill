/**
 * Email Service - Billing Email Templates + Send
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "../../utils/logger.js";
import type { Organization } from "../../models/Organization.js";
import type { User } from "../../models/User.js";
import { getSESClient, EMAIL_CONFIG, generateEmailFooter } from "./helpers.js";
import { generateUnsubscribeToken } from "./unsubscribe.js";
import { isRateLimited, logEmailSend } from "./rate-limit.js";

// =============================================================================
// Types
// =============================================================================

interface NotificationEmailParams {
  user: User;
  organization: Organization;
  unsubscribeUrl: string;
}

interface BillingEmailParams extends NotificationEmailParams {
  amountCents: number;
  balanceCents: number;
}

interface PaymentFailedParams extends NotificationEmailParams {
  reason: string;
}

interface LowBalanceParams extends NotificationEmailParams {
  balanceCents: number;
  thresholdCents: number;
}

// =============================================================================
// HTML Generators
// =============================================================================

/**
 * Generate payment success email HTML
 */
function generatePaymentSuccessEmailHtml(params: BillingEmailParams): string {
  const { organization, amountCents, balanceCents, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt - WorkerMill</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ***REMOVED***f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: ***REMOVED***ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid ***REMOVED***e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ***REMOVED***dcfce7; color: ***REMOVED***166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Payment Successful
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Thank you for your payment!
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid ***REMOVED***e4e4e7;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Amount Added</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***166534;">+$${(amountCents / 100).toFixed(2)}</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">New Balance</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b;">$${(balanceCents / 100).toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Billing
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate payment failed email HTML
 */
function generatePaymentFailedEmailHtml(params: PaymentFailedParams): string {
  const { organization, reason, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Failed - WorkerMill</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ***REMOVED***f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: ***REMOVED***ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid ***REMOVED***e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ***REMOVED***fee2e2; color: ***REMOVED***991b1b; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Payment Failed
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                We couldn't process your payment
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                Your AI workers have been paused until the payment issue is resolved.
              </p>

              <div style="margin: 0 0 24px; background-color: ***REMOVED***fef2f2; border-left: 4px solid ***REMOVED***ef4444; border-radius: 0 6px 6px 0; padding: 16px;">
                <div style="font-size: 12px; color: ***REMOVED***991b1b; text-transform: uppercase; margin-bottom: 8px;">Reason</div>
                <div style="font-size: 14px; color: ***REMOVED***7f1d1d;">${reason}</div>
              </div>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***ef4444; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Update Payment Method
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate low balance warning email HTML
 */
function generateLowBalanceEmailHtml(params: LowBalanceParams): string {
  const { organization, balanceCents, thresholdCents, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Low Balance Warning - WorkerMill</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ***REMOVED***f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: ***REMOVED***ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid ***REMOVED***e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ***REMOVED***fef3c7; color: ***REMOVED***92400e; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Low Balance Warning
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Your credit balance is running low
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                Add credits to continue using AI workers without interruption.
              </p>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***fef3c7; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***92400e; text-transform: uppercase;">Current Balance</div>
                    <div style="font-size: 36px; font-weight: 700; color: ***REMOVED***92400e;">$${(balanceCents / 100).toFixed(2)}</div>
                    <div style="font-size: 14px; color: ***REMOVED***a16207; margin-top: 4px;">Warning threshold: $${(thresholdCents / 100).toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Add Credits
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 14px; color: ***REMOVED***71717a; text-align: center;">
                Tip: Enable auto-recharge to never run out of credits.
              </p>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate auto-recharge success email HTML
 */
function generateAutoRechargeSuccessEmailHtml(params: BillingEmailParams): string {
  const { organization, amountCents, balanceCents, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto-Recharge Complete - WorkerMill</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ***REMOVED***f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: ***REMOVED***ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid ***REMOVED***e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ***REMOVED***dcfce7; color: ***REMOVED***166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Auto-Recharge Complete
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Credits automatically added
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                Your credit balance was automatically topped up.
              </p>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid ***REMOVED***e4e4e7;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Amount Added</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***166534;">+$${(amountCents / 100).toFixed(2)}</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">New Balance</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b;">$${(balanceCents / 100).toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Billing
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

// =============================================================================
// Billing Email Send Functions
// =============================================================================

/**
 * Send payment success email (receipt)
 */
export async function sendPaymentSuccessEmail(
  user: User,
  organization: Organization,
  amountCents: number,
  balanceCents: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Payment Receipt - $${(amountCents / 100).toFixed(2)} added to your WorkerMill account`;
  const htmlBody = generatePaymentSuccessEmailHtml({
    user,
    organization,
    amountCents,
    balanceCents,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

    const client = getSESClient();
    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [user.email] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    });

    const response = await client.send(command);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert", // Reusing existing type for billing
      subject,
      response.MessageId || null,
      "sent",
      null,
      { amountCents, balanceCents, type: "payment_success", unsubscribeToken }
    );

    logger.info("Payment success email sent", {
      userId: user.id,
      amountCents,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      null,
      "failed",
      errorMessage,
      { amountCents, balanceCents, type: "payment_success" }
    );

    logger.error("Failed to send payment success email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(
  user: User,
  organization: Organization,
  reason: string
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = "Payment Failed - Your WorkerMill workers have been paused";
  const htmlBody = generatePaymentFailedEmailHtml({
    user,
    organization,
    reason,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    // Skip rate limit for payment failure - critical notification
    const client = getSESClient();
    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [user.email] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    });

    const response = await client.send(command);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { reason, type: "payment_failed", unsubscribeToken }
    );

    logger.info("Payment failed email sent", {
      userId: user.id,
      reason,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      null,
      "failed",
      errorMessage,
      { reason, type: "payment_failed" }
    );

    logger.error("Failed to send payment failed email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send low balance warning email
 */
export async function sendLowBalanceEmail(
  user: User,
  organization: Organization,
  balanceCents: number,
  thresholdCents: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Low Balance Warning - $${(balanceCents / 100).toFixed(2)} remaining`;
  const htmlBody = generateLowBalanceEmailHtml({
    user,
    organization,
    balanceCents,
    thresholdCents,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

    const client = getSESClient();
    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [user.email] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    });

    const response = await client.send(command);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { balanceCents, thresholdCents, type: "low_balance", unsubscribeToken }
    );

    logger.info("Low balance email sent", {
      userId: user.id,
      balanceCents,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      null,
      "failed",
      errorMessage,
      { balanceCents, thresholdCents, type: "low_balance" }
    );

    logger.error("Failed to send low balance email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send auto-recharge success email
 */
export async function sendAutoRechargeSuccessEmail(
  user: User,
  organization: Organization,
  amountCents: number,
  balanceCents: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Auto-Recharge Complete - $${(amountCents / 100).toFixed(2)} added`;
  const htmlBody = generateAutoRechargeSuccessEmailHtml({
    user,
    organization,
    amountCents,
    balanceCents,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

    const client = getSESClient();
    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [user.email] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    });

    const response = await client.send(command);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { amountCents, balanceCents, type: "auto_recharge_success", unsubscribeToken }
    );

    logger.info("Auto-recharge success email sent", {
      userId: user.id,
      amountCents,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      null,
      "failed",
      errorMessage,
      { amountCents, balanceCents, type: "auto_recharge_success" }
    );

    logger.error("Failed to send auto-recharge success email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}
