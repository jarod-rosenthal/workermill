/**
 * WorkerMill Admin Notifications Service
 *
 * Handles platform-level notifications to admins (you) for events like:
 * - New user signups
 * - New organization creation
 * - Critical system events
 *
 * Uses AWS SNS for SMS and SES for email.
 */

import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

// Initialize AWS clients
const snsClient = new SNSClient({ region: config.aws.region });
const sesClient = new SESClient({ region: config.aws.region });

// Admin contact info from environment
const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const SES_SOURCE_EMAIL = process.env.SES_SOURCE_EMAIL || "noreply@workermill.com";

interface SignupNotification {
  email: string;
  fullName: string;
  organizationName: string;
  referralCode?: string;
}

/**
 * Send SMS notification via AWS SNS
 */
async function sendSms(message: string): Promise<boolean> {
  if (!ADMIN_PHONE) {
    logger.debug("Admin phone not configured, skipping SMS notification");
    return false;
  }

  try {
    const command = new PublishCommand({
      PhoneNumber: ADMIN_PHONE,
      Message: message,
      MessageAttributes: {
        "AWS.SNS.SMS.SenderID": {
          DataType: "String",
          StringValue: "WorkerMill",
        },
        "AWS.SNS.SMS.SMSType": {
          DataType: "String",
          StringValue: "Transactional",
        },
      },
    });

    await snsClient.send(command);
    logger.info("Admin SMS notification sent", { phone: ADMIN_PHONE.slice(0, 6) + "****" });
    return true;
  } catch (error) {
    logger.error("Failed to send admin SMS notification", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Send email notification via AWS SES
 */
async function sendAdminEmail(subject: string, htmlBody: string, textBody: string): Promise<boolean> {
  if (!ADMIN_EMAIL) {
    logger.debug("Admin email not configured, skipping email notification");
    return false;
  }

  try {
    const command = new SendEmailCommand({
      Source: SES_SOURCE_EMAIL,
      Destination: {
        ToAddresses: [ADMIN_EMAIL],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: "UTF-8",
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: "UTF-8",
          },
          Text: {
            Data: textBody,
            Charset: "UTF-8",
          },
        },
      },
    });

    await sesClient.send(command);
    logger.info("Admin email notification sent", { email: ADMIN_EMAIL });
    return true;
  } catch (error) {
    logger.error("Failed to send admin email notification", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Notify admin of a new user signup
 */
export async function notifyNewSignup(data: SignupNotification): Promise<void> {
  const { email, fullName, organizationName, referralCode } = data;

  // SMS notification (brief)
  const smsMessage = `WorkerMill: New signup!\n${fullName} (${email})\nOrg: ${organizationName}${referralCode ? `\nRef: ${referralCode}` : ""}`;

  // Email notification (detailed)
  const subject = `New WorkerMill Signup: ${fullName}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: ***REMOVED***0ea5e9;">New User Signup</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: ***REMOVED***64748b;">Name:</td>
          <td style="padding: 8px 0; font-weight: 600;">${fullName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: ***REMOVED***64748b;">Email:</td>
          <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: ***REMOVED***0ea5e9;">${email}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: ***REMOVED***64748b;">Organization:</td>
          <td style="padding: 8px 0; font-weight: 600;">${organizationName}</td>
        </tr>
        ${referralCode ? `
        <tr>
          <td style="padding: 8px 0; color: ***REMOVED***64748b;">Referral Code:</td>
          <td style="padding: 8px 0;">${referralCode}</td>
        </tr>
        ` : ""}
        <tr>
          <td style="padding: 8px 0; color: ***REMOVED***64748b;">Time:</td>
          <td style="padding: 8px 0;">${new Date().toISOString()}</td>
        </tr>
      </table>
      <hr style="border: none; border-top: 1px solid ***REMOVED***e2e8f0; margin: 20px 0;" />
      <p style="color: ***REMOVED***64748b; font-size: 14px;">
        <a href="https://workermill.com/admin/users" style="color: ***REMOVED***0ea5e9;">View in Dashboard</a>
      </p>
    </div>
  `;

  const textBody = `
New WorkerMill Signup

Name: ${fullName}
Email: ${email}
Organization: ${organizationName}
${referralCode ? `Referral Code: ${referralCode}` : ""}
Time: ${new Date().toISOString()}

View in Dashboard: https://workermill.com/admin/users
  `.trim();

  // Send both notifications in parallel
  const results = await Promise.allSettled([
    sendSms(smsMessage),
    sendAdminEmail(subject, htmlBody, textBody),
  ]);

  const smsResult = results[0];
  const emailResult = results[1];

  logger.info("Admin signup notification completed", {
    email: data.email,
    smsSent: smsResult.status === "fulfilled" && smsResult.value,
    emailSent: emailResult.status === "fulfilled" && emailResult.value,
  });
}

/**
 * Check if admin notifications are configured
 */
export function isAdminNotificationsConfigured(): { sms: boolean; email: boolean } {
  return {
    sms: !!ADMIN_PHONE,
    email: !!ADMIN_EMAIL,
  };
}
