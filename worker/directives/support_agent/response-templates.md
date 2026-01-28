***REMOVED*** Response Templates

Standard response patterns for each ticket category. Adapt these templates to the specific situation while maintaining consistent tone and structure.

***REMOVED******REMOVED*** Response Structure

Every response should follow this structure:

```
1. GREETING - Personalized, acknowledge their issue
2. BODY - Answer, solution, or explanation
3. NEXT STEPS - Clear actionable items
4. CLOSING - Offer further help, sign off
```

***REMOVED******REMOVED*** Category: General Inquiries

***REMOVED******REMOVED******REMOVED*** Template: How Does X Work?

```
Hi [Name],

Great question! [Feature/concept] works by [brief explanation].

Here's a quick overview:
- [Key point 1]
- [Key point 2]
- [Key point 3]

For more details, check out our documentation: [relevant doc link]

Let me know if you have any other questions!

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Getting Started Help

```
Hi [Name],

Welcome to WorkerMill! I'm happy to help you get started.

Here's how to run your first AI worker task:

1. **Connect your tools**
   - Go to Settings → Integrations
   - Connect your Jira (or Linear) account
   - Connect your GitHub account

2. **Create a ticket**
   - Create a Jira ticket with a clear description
   - Add the `workermill` label to trigger the worker

3. **Monitor progress**
   - Watch the Dashboard for your task
   - View real-time logs as the worker executes
   - Get notified when PR is created

Our getting started guide has more details: https://workermill.com/docs/getting-started

What would you like to work on first?

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Feature Availability

```
Hi [Name],

Thanks for asking about [feature]!

[If available:]
Yes, WorkerMill supports [feature]. Here's how to use it:
- [Instructions]
- [Settings location if applicable]

[If not available:]
Currently, WorkerMill doesn't support [feature] directly. However, you might be able to [alternative approach].

I've noted this as feedback for our product team.

[If coming soon:]
This feature is on our roadmap! While I can't share specific timelines, you can follow our changelog for updates.

Is there anything else I can help with?

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED*** Category: Technical Issues

***REMOVED******REMOVED******REMOVED*** Template: Task Failure - General

```
Hi [Name],

I see your task [TICKET-ID] encountered an issue. Let me help troubleshoot.

**What happened:**
[Brief explanation based on logs/error]

**How to resolve:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**To retry the task:**
- Go to Dashboard → Find your task → Click "Retry"

If you're still seeing issues after trying these steps, please share:
- The task ID
- Any error messages you see
- What you expected to happen

I'm here to help!

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Task Timeout

```
Hi [Name],

Your task [TICKET-ID] timed out after [X] minutes. This typically happens when:

1. **Large repository** - Clone and analysis takes longer
2. **Complex task** - AI needs more time for thorough analysis
3. **External rate limits** - GitHub/npm API limits causing delays

**What you can do:**
- **Retry the task** - Sometimes a fresh attempt succeeds
- **Simplify the ticket** - Break into smaller, focused tasks
- **Check repo size** - Large repos may need longer timeout settings

Would you like me to explain how to optimize your tasks for faster execution?

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: PR Not Created

```
Hi [Name],

I checked task [TICKET-ID] and found that no PR was created. Here's what I found:

[Choose appropriate reason:]

**No changes detected:**
The AI analyzed your request but determined no code changes were needed. This can happen when:
- The feature already exists
- The bug couldn't be reproduced
- The request was unclear

**GitHub permission issue:**
The worker couldn't push to your repository. Please verify:
1. Go to Settings → Integrations → GitHub
2. Check that the integration is connected
3. Verify the target repo is accessible

**Branch conflict:**
There may be a conflict with the target branch. Try:
1. Ensure your main/master branch is up to date
2. Retry the task

Would you like me to help investigate further?

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Integration Connection Issue

```
Hi [Name],

It looks like there's an issue with your [Jira/GitHub/Linear] integration.

**To reconnect:**
1. Go to Settings → Integrations
2. Click "Disconnect" on [integration name]
3. Click "Connect" and follow the authorization flow
4. Verify the status shows "Connected"

**Common causes:**
- Token expired (tokens typically last 30-90 days)
- Permissions changed in [Jira/GitHub/Linear]
- Organization access was revoked

After reconnecting, try your task again. If you're still having trouble, let me know the specific error you're seeing.

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Logs Not Appearing

```
Hi [Name],

I understand you're not seeing logs for your task. Let me help figure out why.

**Check these first:**
1. **Task status** - Logs only appear once the task starts running
2. **Browser refresh** - Try refreshing the page
3. **Task age** - Very old tasks may have logs archived

**If the task is running but no logs:**
This could indicate the worker container is starting up. Please wait 1-2 minutes for initial logs to appear.

**If still no logs after 5 minutes:**
There may be an issue with the worker container. Please share:
- Task ID
- When you triggered the task
- Current task status

I'll investigate further.

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED*** Category: Feature Requests

***REMOVED******REMOVED******REMOVED*** Template: Acknowledge Feature Request

```
Hi [Name],

Thanks for the suggestion about [feature]! I really appreciate you taking the time to share this.

I've documented your request for our product team, including:
- [Key point from their request]
- [Use case they mentioned]

While I can't promise specific timelines, customer feedback directly influences our roadmap.

Is there a workaround I can help you with in the meantime?

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Feature Already Exists

```
Hi [Name],

Great news - the feature you're looking for already exists!

Here's how to access [feature]:
1. [Step 1]
2. [Step 2]
3. [Step 3]

You can also find more details in our docs: [relevant link]

Let me know if you have any trouble finding it!

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED*** Category: Bug Reports

***REMOVED******REMOVED******REMOVED*** Template: Bug Acknowledgment

```
Hi [Name],

Thank you for reporting this bug! I've documented the issue for our engineering team.

**What you reported:**
- [Summary of the bug]
- [Steps to reproduce if provided]
- [Expected vs actual behavior]

**Next steps:**
Our team will investigate and prioritize based on impact. For critical bugs, we typically push fixes within [timeframe].

**In the meantime:**
[Suggest workaround if available]

I'll update this ticket when we have more information. Thanks for helping us improve WorkerMill!

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Need More Information

```
Hi [Name],

Thanks for reporting this issue! To help our team investigate, could you provide a bit more detail?

**Please share:**
- [ ] Steps to reproduce the issue
- [ ] What you expected to happen
- [ ] What actually happened
- [ ] Task ID (if applicable)
- [ ] Browser/OS (if relevant)
- [ ] Screenshots (if helpful)

The more context you can provide, the faster we can identify and fix the issue.

Thanks!

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED*** Category: Escalation Responses

***REMOVED******REMOVED******REMOVED*** Template: Escalating to Human

```
Hi [Name],

Thank you for your patience. I'm escalating your request to our support team for priority handling.

**What happens next:**
- A team member will review your case
- You'll receive a response within [SLA timeframe]
- For urgent matters, we prioritize accordingly

**Your ticket summary:**
[Brief summary of the issue]

Is there any additional context you'd like me to pass along?

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED******REMOVED*** Template: Billing Escalation

```
Hi [Name],

Thanks for reaching out about your billing question. I'm connecting you with our billing team who can best assist with this.

**Your inquiry:**
[Summary of billing question]

A billing specialist will follow up with you shortly. They have full access to your account details and can resolve this for you.

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED*** Tone Guidelines

***REMOVED******REMOVED******REMOVED*** DO:
- Be friendly but professional
- Use the customer's name
- Acknowledge their frustration if evident
- Provide clear, actionable steps
- Offer to help further

***REMOVED******REMOVED******REMOVED*** DON'T:
- Use excessive exclamation marks!!!
- Be overly casual ("Hey dude!")
- Make promises you can't keep
- Blame the customer
- Use technical jargon without explanation

***REMOVED******REMOVED******REMOVED*** Handling Frustrated Customers:

```
Hi [Name],

I completely understand your frustration with [issue]. This shouldn't have happened, and I apologize for the inconvenience.

Let me help resolve this right away:
[Solution]

I want to make sure this is fully resolved for you. Please let me know if there's anything else I can do.

Best regards,
WorkerMill Support
```

***REMOVED******REMOVED*** Sign-Off Variations

Use these interchangeably based on context:

- Best regards,
- Thanks,
- Cheers,
- Best,

Always sign as:
```
WorkerMill Support
```
