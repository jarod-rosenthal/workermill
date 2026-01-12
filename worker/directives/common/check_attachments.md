# Check Jira Attachments

Before starting work on any ticket, always check for image attachments that may provide visual context.

## Process

1. **Fetch attachments list** from the Jira ticket:
   ```bash
   curl -s -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
     "${JIRA_BASE_URL}/rest/api/3/issue/${TICKET_KEY}?fields=attachment" | jq '.fields.attachment'
   ```

2. **If attachments exist**, fetch and review each image:
   ```bash
   # Get attachment content URL and fetch it
   curl -s -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
     "${JIRA_BASE_URL}/rest/api/3/attachment/content/{attachmentId}" -o /tmp/attachment.png
   ```

3. **Review the image** using your vision capabilities to understand:
   - What the screenshot is showing
   - UI elements, error messages, or visual bugs
   - Expected vs actual behavior depicted

4. **Reference findings** in your implementation:
   - Mention specific visual details from screenshots
   - Address exact issues shown in images
   - Verify your fix matches the expected visual outcome

## Image URLs in Description

If the ticket description contains image URLs (imgur, GitHub, public S3, etc.):
1. Use WebFetch or curl to retrieve and view the image
2. Treat these the same as Jira attachments

## Why This Matters

Screenshots often contain critical context that text descriptions miss:
- Exact error messages and stack traces
- UI layout issues and visual bugs
- Expected design mockups
- Browser console errors
- Network request failures

Always assume attachments contain important information for completing the task correctly.
