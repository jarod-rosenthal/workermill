# Quality Checks

Self-review criteria for support responses. Run through this checklist before posting any response.

## Pre-Response Checklist

### 1. Completeness

- [ ] **All questions answered** - Did you address every question in the ticket?
- [ ] **Context considered** - Did you read the full conversation history?
- [ ] **Relevant details included** - Did you provide enough information?
- [ ] **Nothing assumed** - Did you ask clarifying questions if needed?

### 2. Accuracy

- [ ] **Facts verified** - Is everything you stated factually correct?
- [ ] **No guessing** - Did you avoid speculation presented as fact?
- [ ] **Links valid** - Are documentation links correct and current?
- [ ] **Steps tested** - Would your instructions actually work?

### 3. Tone

- [ ] **Professional** - Is the tone appropriate for business communication?
- [ ] **Empathetic** - Did you acknowledge the customer's situation?
- [ ] **Helpful** - Does the response genuinely try to solve their problem?
- [ ] **Not defensive** - Did you avoid making excuses?

### 4. Actionability

- [ ] **Clear next steps** - Does the customer know what to do next?
- [ ] **Specific instructions** - Are steps detailed enough to follow?
- [ ] **Alternatives provided** - If one solution doesn't work, is there a backup?
- [ ] **Follow-up offered** - Did you invite them to reach out again?

### 5. Format

- [ ] **Readable** - Is the response easy to scan?
- [ ] **Appropriate length** - Not too long, not too short?
- [ ] **Structured** - Uses lists, headers, or formatting when helpful?
- [ ] **Properly signed** - Includes appropriate sign-off?

## Quality Scoring

Rate your response on each dimension (1-5 scale):

| Dimension | Score | Description |
|-----------|-------|-------------|
| Completeness | | All questions addressed |
| Accuracy | | Factually correct, no guessing |
| Tone | | Professional, empathetic, helpful |
| Actionability | | Clear next steps provided |
| Format | | Well-structured, readable |

**Overall Confidence Score** = Average of all dimensions × 20

Example: (4 + 5 + 4 + 5 + 4) / 5 × 20 = 88%

### Confidence Thresholds

| Score | Action |
|-------|--------|
| > 80% | Post response directly |
| 60-80% | Post with flag for human review |
| < 60% | Do not post, escalate instead |

## Common Quality Issues

### Issue: Over-Promising

**Bad:** "This will definitely fix your issue!"
**Good:** "This should resolve the issue. If you're still experiencing problems, let me know."

### Issue: Technical Jargon

**Bad:** "The ECS Fargate container's exit code 137 indicates an OOM kill."
**Good:** "The worker ran out of memory and was stopped. This can happen with very large repositories."

### Issue: Wall of Text

**Bad:** Long paragraphs without formatting
**Good:** Short paragraphs, bullet points, numbered steps

### Issue: Missing Empathy

**Bad:** "You need to reconnect your GitHub integration."
**Good:** "I understand this is frustrating. Let's get your GitHub integration reconnected - here's how:"

### Issue: Incomplete Instructions

**Bad:** "Check your GitHub settings."
**Good:** "Go to Settings → Integrations → GitHub, then click 'Reconnect'."

### Issue: Vague Next Steps

**Bad:** "Let me know if you need anything else."
**Good:** "If the issue persists after trying these steps, please share your task ID and I'll investigate further."

## Response Review Examples

### Example 1: Good Response

**Ticket:** "My task failed with an error"

**Response:**
```
Hi Sarah,

I see your task OCS-123 failed with a GitHub authentication error. This typically happens when:
- Your GitHub token has expired
- Repository permissions changed
- Rate limits were hit

Here's how to fix it:
1. Go to Settings → Integrations → GitHub
2. Click "Reconnect" to refresh your token
3. Retry the task from the Dashboard

If you're still seeing issues after reconnecting, please share:
- The exact error message
- Your task ID

I'm here to help!

Best regards,
WorkerMill Support
```

**Quality Score:**
- Completeness: 5 - Addressed the error, provided solution
- Accuracy: 5 - Correct information about GitHub auth
- Tone: 5 - Professional, helpful, empathetic
- Actionability: 5 - Clear numbered steps
- Format: 5 - Well-structured, scannable

**Overall: 100%** ✓ Post directly

### Example 2: Needs Improvement

**Ticket:** "Why is my task taking so long?"

**Response:**
```
Tasks can take a while sometimes. Try waiting or retrying.
```

**Quality Score:**
- Completeness: 2 - Doesn't explain why or provide diagnostics
- Accuracy: 3 - True but unhelpful
- Tone: 2 - Dismissive, not empathetic
- Actionability: 2 - Vague, no specific steps
- Format: 2 - Too brief, no structure

**Overall: 44%** ✗ Do not post, rewrite

**Improved Response:**
```
Hi Alex,

I understand waiting for tasks to complete can be frustrating. Let me help figure out what's happening.

**Common reasons for long-running tasks:**
- Large repository (clone takes longer)
- Complex analysis (AI needs more time)
- External rate limits (GitHub/npm APIs)

**To diagnose:**
1. Check the task logs in Dashboard for progress
2. Look for any error messages or warnings
3. Note how long it's been running

**What's normal:**
- Simple tasks: 5-15 minutes
- Complex tasks: 15-30 minutes
- Very large repos: Could be longer

If your task has been running for over 30 minutes with no log activity, it may have stalled. Share your task ID and I'll take a closer look.

Best regards,
WorkerMill Support
```

## Final Review Process

Before posting, ask yourself:

1. **Would I be satisfied with this response if I were the customer?**
2. **Does this response respect the customer's time?**
3. **Is there anything I'm uncertain about that I should escalate instead?**
4. **Have I followed the escalation rules for this ticket type?**

If any answer is "no" or "unsure," revise or escalate.

## Continuous Improvement

After responses are posted:
- Track customer replies (did they need follow-up?)
- Note common questions for knowledge base updates
- Flag responses that needed human correction
- Update templates based on successful patterns

## Output Markers

Include these markers in your response metadata:

```
::confidence::85      # Your quality score
::response::posted    # Response successfully sent
::needs_review::true  # Flag for human review (if score 60-80%)
```
