# Team Onboarding Flow - Bug Analysis

**Date:** 2026-02-01
**Reported by:** jarod@oncallshift.com
**Symptoms:** Sent invite to test111@oncallshift.com, accepted invite, got server error. Payload was trying to create "Tests' Organization" but user was never prompted to enter an org name.

---

## Executive Summary

The team invite/onboarding flow has multiple architectural issues that can cause users to end up in incorrect states. The core problem is that the **signup flow sends a placeholder organization name** (`{name}'s Organization`) to the backend even when joining via invite, relying on the backend to detect the invite and ignore it. When this detection fails for any reason, the system attempts to create an organization the user never asked for.

---

## Issues Identified

### CRITICAL: Issue #1 - Placeholder Organization Name in Invite Flow

**Location:** `frontend/src/pages/Signup.tsx:272`

```typescript
// For invite flow, use a placeholder org name (user will join invited org after verification)
const response = await authAPI.signup({
  email: formData.email,
  password: formData.password,
  name: formData.name.trim(),
  // For invite flow, backend will detect pending invite and skip org creation
  organizationName: isInviteFlow ? `${formData.name.trim()}'s Organization` : formData.organizationName.trim(),
  ...
});
```

**Problem:** The frontend ALWAYS sends an `organizationName`, using a placeholder like "Tests' Organization" when in invite flow. The backend is supposed to detect the pending invite and ignore this placeholder, but:

1. If invite lookup fails (email mismatch, already accepted, expired, DB error)
2. The backend falls through to creating an organization with the placeholder name
3. User ends up with an unwanted organization instead of joining the invited one

**Fix Required:**
- Frontend should NOT send `organizationName` when in invite flow
- Backend should reject signup requests with `organizationName` when user has a pending invite
- Or: Use a separate signup endpoint for invite flow that doesn't accept `organizationName`

---

### HIGH: Issue #2 - No Email Validation on Invite Acceptance

**Location:** `api/src/routes/organizations.ts:758-762`

```typescript
// Note: We don't compare cognitoUser.email with invite.email because:
// 1. Cognito access tokens don't include the email claim
// 2. The invite link itself acts as proof of email ownership (sent to that email)
// 3. Using the invite's email ensures user is created with the invited email
```

**Problem:** ANY authenticated user can accept ANY invite they have the token for. This is intentional but leads to confusion:

1. Admin sends invite to test111@oncallshift.com
2. Admin accidentally clicks "Accept Invitation" while testing
3. Admin (already a member) triggers the flow, potentially causing unexpected behavior
4. Or: Someone forwards the invite link, wrong person accepts it

**Security Consideration:** The invite link IS proof of email access (received via email), but there's no server-side validation that the accepting user's email matches.

---

### HIGH: Issue #3 - Multiple Redirect Paths After Signup Can Lose Invite Context

**The Flow:**
```
Signup → Email Verification → Login → Accept Invite
```

**Problem Points:**

1. **After signup** (Signup.tsx:206-229):
   - If NOT auto-confirmed: Redirects to `/verify-email?invite=<token>`
   - Invite token is passed via URL parameter

2. **After email verification** (VerifyEmail.tsx:32-44):
   - Redirects to `/invites/<token>` ✓ (correct)
   - But user is NOT logged in yet

3. **At AcceptInvite page** (not authenticated):
   - Shows "Log in or Sign up" buttons
   - Links include invite token in URL params ✓

4. **After login** (Login.tsx:211-219):
   ```typescript
   if (inviteToken) {
     navigate(`/invites/${inviteToken}`);
   } else if (me.needsSetup) {
     navigate("/onboarding");  // <-- PROBLEM
   }
   ```

**The Bug:** If the user navigates away, refreshes, or manually goes to `/login` (without the `?invite=` param), they'll be redirected to `/onboarding` instead of the invite acceptance page.

---

### HIGH: Issue #4 - Onboarding Page Doesn't Check for Pending Invites

**Location:** `frontend/src/pages/Onboarding.tsx`

**Problem:** The Onboarding page shows two options:
1. Create New Organization
2. Join Existing Organization (requires manually entering invite token)

But it doesn't:
- Check if the user has a pending invite
- Pre-fill the invite token from URL/session
- Warn the user they have a pending invite

**Scenario:**
1. User signs up with invite
2. User somehow ends up at `/onboarding` (lost the invite token)
3. User sees "Create New Organization" - clicks it
4. User enters org name (or it's somehow pre-filled from previous state?)
5. Creates wrong organization instead of joining invited one

---

### MEDIUM: Issue #5 - Race Condition in Invite Lookup During Signup

**Location:** `api/src/routes/auth.ts:374-380`

```typescript
const pendingInvite = await inviteRepo.findOne({
  where: { email: email.toLowerCase(), accepted: false },
});
const hasValidInvite = pendingInvite && !pendingInvite.isExpired();
```

**Problem:** The invite lookup happens AFTER the Cognito user is created. If:
1. User A sends invite to email X
2. User X starts signup
3. Cognito user created
4. Before DB lookup completes, User A cancels/expires the invite
5. DB lookup finds no invite
6. System creates unwanted organization

---

### MEDIUM: Issue #6 - Inconsistent Email Normalization

**Invite Creation** (organizations.ts):
```typescript
email: email.toLowerCase(),
```

**Signup Invite Lookup** (auth.ts):
```typescript
where: { email: email.toLowerCase(), accepted: false }
```

This looks consistent, BUT:
- Express-validator's `normalizeEmail()` does more than just lowercase
- It removes dots from gmail, handles plus signs, etc.
- Could cause mismatches

**Example:**
- Invite sent to: `test111@oncallshift.com`
- User signs up with: `Test111@oncallshift.com` (capital T)
- After `normalizeEmail()`: Might transform differently

---

### LOW: Issue #7 - No Logging of Invite Token in Signup Request

When debugging, it's hard to trace why an invite wasn't found because:
1. Frontend sends invite token in URL params but not in request body
2. Backend logs `pendingInvite.orgId` but not the invite token from the request
3. Hard to correlate frontend invite context with backend behavior

---

## Flow Diagrams

### Expected Flow (Happy Path)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Admin sends invite to test111@oncallshift.com                 │
│    POST /api/organizations/current/invites                       │
│    → OrgInvite created with token, email, orgId                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 2. User receives email with link: /invites/<token>               │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 3. User clicks link → AcceptInvite.tsx                           │
│    GET /api/invites/<token> → Shows org name, role, inviter      │
│    User is NOT authenticated → Shows "Log in" / "Sign up"        │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 4. User clicks "Sign up" → /signup?email=...&invite=<token>      │
│    Signup.tsx: isInviteFlow = true                               │
│    Org name field HIDDEN but placeholder sent to backend         │
│    POST /auth/signup { organizationName: "Tests' Organization" } │
│                                                                  │
│    Backend SHOULD:                                               │
│    - Find pending invite by email                                │
│    - Skip org creation                                           │
│    - Create user with orgId: null                                │
│    - Return { inviteToken: "..." }                               │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 5. Email verification required                                   │
│    → /verify-email?email=...&invite=<token>                      │
│    User enters code, email confirmed                             │
│    → Redirect to /invites/<token>                                │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 6. AcceptInvite.tsx - still not logged in                        │
│    → User clicks "Log in"                                        │
│    → /login?email=...&invite=<token>                             │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 7. Login.tsx                                                     │
│    User enters credentials                                       │
│    POST /auth/login → tokens                                     │
│    GET /auth/me → { needsSetup: true } (no org yet)              │
│    IMPORTANT: Has inviteToken from URL                           │
│    → Redirect to /invites/<token> (NOT /onboarding!)             │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│ 8. AcceptInvite.tsx - now logged in                              │
│    isAuthenticated = true                                        │
│    Shows "Accept Invitation" button                              │
│    User clicks → POST /api/invites/<token>/accept                │
│    → UserOrganization created, invite deleted                    │
│    → Redirect to /dashboard                                      │
└──────────────────────────────────────────────────────────────────┘
```

### Bug Flow (What Can Go Wrong)

```
┌──────────────────────────────────────────────────────────────────┐
│ FAILURE POINT 1: Invite lookup fails during signup               │
│                                                                  │
│ Possible causes:                                                 │
│ - Email normalization mismatch                                   │
│ - Invite already accepted (admin tested it)                      │
│ - Invite expired                                                 │
│ - Database error                                                 │
│                                                                  │
│ Result: Backend creates org with "Tests' Organization"           │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ FAILURE POINT 2: Invite token lost in redirect chain             │
│                                                                  │
│ User at step 6 refreshes page, loses ?invite=<token>             │
│ → Logs in without invite context                                 │
│ → GET /auth/me returns { needsSetup: true }                      │
│ → Login redirects to /onboarding (not /invites/<token>)          │
│ → User sees "Create Organization" option                         │
│ → User creates org instead of joining invited one                │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ FAILURE POINT 3: Admin accidentally accepts own invite           │
│                                                                  │
│ Admin sends invite, clicks link to test                          │
│ Admin is already authenticated                                   │
│ AcceptInvite shows "Accept Invitation" (no email check!)         │
│ Admin clicks Accept → Backend sees admin is already a member     │
│ → Invite deleted, test111 can no longer use it                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Recommended Fixes

### Fix 1: Don't Send Placeholder Org Name in Invite Flow (HIGH PRIORITY)

**Frontend Change:**
```typescript
// Signup.tsx
const response = await authAPI.signup({
  email: formData.email,
  password: formData.password,
  name: formData.name.trim(),
  // Only send organizationName if NOT in invite flow
  ...(isInviteFlow ? {} : { organizationName: formData.organizationName.trim() }),
  referralCode: formData.referralCode.trim() || undefined,
  tosAccepted: formData.tosAccepted,
});
```

**Backend Change:**
```typescript
// auth.ts - Make organizationName optional when invite exists
body("organizationName")
  .optional()  // Make optional
  .trim()
  .isLength({ min: 1, max: 255 })

// In signup handler:
if (!hasValidInvite && !organizationName) {
  return res.status(400).json({
    error: "Organization name required for new accounts without invitation"
  });
}
```

### Fix 2: Store Invite Token in Session/LocalStorage (HIGH PRIORITY)

**Frontend Change:**
```typescript
// When user arrives at AcceptInvite with valid invite
useEffect(() => {
  if (token && invite) {
    sessionStorage.setItem("pendingInviteToken", token);
  }
}, [token, invite]);

// In Login.tsx, check session storage too
const storedInviteToken = sessionStorage.getItem("pendingInviteToken");
const effectiveInviteToken = inviteToken || storedInviteToken;

if (effectiveInviteToken) {
  navigate(`/invites/${effectiveInviteToken}`);
} else if (me.needsSetup) {
  navigate("/onboarding");
}
```

### Fix 3: Onboarding Should Check for Pending Invites (MEDIUM PRIORITY)

```typescript
// Onboarding.tsx - Add check on mount
useEffect(() => {
  const checkPendingInvite = async () => {
    try {
      // New API endpoint to check if user has pending invite
      const response = await authAPI.checkPendingInvite();
      if (response.inviteToken) {
        // Redirect to accept invite instead of showing onboarding
        navigate(`/invites/${response.inviteToken}`);
      }
    } catch (err) {
      // No pending invite, show normal onboarding
    }
  };
  checkPendingInvite();
}, []);
```

### Fix 4: Add Email Validation Warning (LOW PRIORITY)

```typescript
// AcceptInvite.tsx - Warn if logged-in user email doesn't match invite
{isAuthenticated && invite && user?.email?.toLowerCase() !== invite.email.toLowerCase() && (
  <div className="p-4 text-sm text-amber-400 bg-amber-500/10 rounded-xl">
    <strong>Warning:</strong> You're logged in as {user?.email} but this invite was sent to {invite.email}.
  </div>
)}
```

---

## Files Involved

| File | Role |
|------|------|
| `frontend/src/pages/AcceptInvite.tsx` | Invite acceptance UI |
| `frontend/src/pages/Signup.tsx` | User registration (sends placeholder org name) |
| `frontend/src/pages/Login.tsx` | Login + redirect logic |
| `frontend/src/pages/VerifyEmail.tsx` | Email verification + redirect |
| `frontend/src/pages/Onboarding.tsx` | Org creation/joining UI |
| `frontend/src/App.tsx` | Route protection, needsSetup redirect |
| `api/src/routes/auth.ts` | `/auth/signup`, `/auth/complete-setup`, `/auth/me` |
| `api/src/routes/organizations.ts` | `/invites/:token/accept`, invite creation |
| `api/src/models/OrgInvite.ts` | Invite model |
| `api/src/models/UserOrganization.ts` | Membership tracking |

---

## Testing Checklist

- [ ] New user signup via invite (standard flow)
- [ ] New user signup via invite (email verification required)
- [ ] Existing user accepts invite for new org
- [ ] Admin accidentally clicks own invite link
- [ ] User loses invite token, ends up at onboarding
- [ ] User with pending invite goes directly to /login
- [ ] User refreshes during email verification
- [ ] Invite expires during signup process
- [ ] Email normalization edge cases (gmail dots, plus signs, case)

---

## Immediate Action Items

1. **Add logging** to track invite token flow through signup/login/accept
2. **Fix placeholder org name** - don't send it in invite flow
3. **Persist invite token** in session storage as backup
4. **Add pending invite check** to onboarding page
5. **Consider email validation** (at least warning) on invite acceptance
