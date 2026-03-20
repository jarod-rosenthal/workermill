# Manual Testing Guide

This document provides detailed testing procedures for the WorkerMill Mobile App, specifically covering Group B acceptance criteria (13-25) which require device testing. These tests must be performed on a physical Android device with the preview APK installed.

## Prerequisites

- Android device running API level 24 (Android 7.0) or higher
- WorkerMill preview APK installed via EAS build
- Android Debug Bridge (ADB) installed on development machine
- Android GPU Profiler (part of Android Studio SDK Platform Tools)
- Access to WorkerMill production API at https://workermill.com/api
- Valid WorkerMill account with test data (tasks, boards)

## Device Setup

1. **Enable Developer Options**:
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times to enable developer options
   - Go to Settings → System → Developer Options

2. **Enable USB Debugging**:
   - In Developer Options, toggle "USB Debugging" on
   - Connect device to computer via USB
   - Accept the USB debugging permission prompt

3. **Install Android GPU Profiler**:
   - Install Android Studio or download SDK Platform Tools
   - Ensure `adb` command is in your PATH
   - Verify device connection: `adb devices`

## Group B Acceptance Criteria Testing

### Criterion 13: Email/Password Sign-In

**Objective**: Verify user can sign in with email/password and reach Dashboard

**Steps**:
1. Launch the WorkerMill app
2. If biometric prompt appears, tap "Cancel" or "Use Password"
3. On sign-in screen, enter valid WorkerMill email and password
4. Tap "Sign In" button
5. **Expected Result**: App navigates to Dashboard tab showing task list
6. **Failure Indicators**:
   - Login fails with valid credentials
   - App crashes or shows error screen
   - Dashboard doesn't load after successful auth

### Criterion 14: SSO Provider Sign-In

**Objective**: Verify SSO authentication works for all available providers

**Steps**:
1. Launch app and reach sign-in screen
2. Observe available SSO buttons (GitHub, Google, Microsoft, etc.)
3. Tap one SSO provider button
4. **Expected Result**: Browser opens with provider's OAuth page
5. Complete authentication in browser
6. **Expected Result**: Browser redirects back to app with auth success
7. **Expected Result**: App navigates to Dashboard tab
8. **Test all available providers** listed on the sign-in screen

**Failure Indicators**:
- Browser doesn't open
- OAuth flow fails or gets stuck
- Redirect back to app doesn't work
- App doesn't receive auth tokens

### Criterion 15: Real-Time Task Updates

**Objective**: Verify Dashboard shows live task status updates via SSE

**Prerequisites**: Have active tasks in your WorkerMill organization

**Steps**:
1. Sign in and reach Dashboard tab
2. Note current task statuses in the list
3. **From another device/browser**, trigger a task status change:
   - Cancel a task
   - Start a new task
   - Let a task complete
4. **Expected Result**: Dashboard task list updates within 5 seconds without pull-to-refresh
5. **Verification**: Status badges change color, new tasks appear, completed tasks move to "Recent" section

**Failure Indicators**:
- Task list doesn't update automatically
- Must pull-to-refresh to see changes
- Status badges show incorrect colors
- SSE connection fails silently

### Criterion 16: Offline/Reconnection Banner

**Objective**: Verify offline banner appears and disappears correctly

**Steps**:
1. Start on Dashboard tab with active SSE connection
2. **Disable device WiFi and cellular data** completely
3. **Expected Result**: Amber "Offline — reconnecting..." banner appears below stats bar within 30 seconds
4. **Re-enable network connection**
5. **Expected Result**: Banner disappears within 5 seconds of reconnection
6. **Expected Result**: Task list updates resume automatically

**Failure Indicators**:
- No offline banner appears when disconnected
- Banner doesn't disappear when reconnected
- App crashes when network is lost
- SSE doesn't reconnect after network restoration

### Criterion 17: Empty State Display

**Objective**: Verify empty state shows when no tasks exist

**Prerequisites**: WorkerMill organization with zero active, queued, or recent tasks

**Steps**:
1. Sign in to organization with no tasks
2. Navigate to Dashboard tab
3. **Expected Result**: Centered message displays "No active tasks. Start a task from the Boards tab." with boards tab icon
4. **Expected Result**: No task list items are shown

**Alternative Test** (if tasks exist):
1. Use test organization or create new organization with no tasks
2. Follow steps above

**Failure Indicators**:
- Empty state message doesn't appear
- Blank screen or loading spinner shows indefinitely
- Error message instead of proper empty state

### Criterion 18: Board and Card Management

**Objective**: Verify full board/card workflow functions correctly

**Steps**:
1. Navigate to Boards tab
2. **Expected Result**: List of boards loads successfully
3. Tap a board from the list
4. **Expected Result**: Board detail screen opens with columns (To Do, In Progress, etc.)
5. **Expected Result**: Cards display in appropriate columns
6. Tap "+" button at bottom of any column
7. **Expected Result**: "Add card" modal opens
8. Enter card title and description
9. Tap "Create" or "Save"
10. **Expected Result**: New card appears in the column
11. **Expected Result**: Card shows issue key (PREFIX-N), title, and any labels

**Failure Indicators**:
- Boards list fails to load
- Board detail screen crashes
- Cannot create new cards
- Cards don't display correctly

### Criterion 19: Task Detail Log Streaming

**Objective**: Verify streaming logs display correctly with proper formatting

**Prerequisites**: Active task that generates logs

**Steps**:
1. From Dashboard, tap on an active task
2. **Expected Result**: Task Detail screen opens with header info
3. **Expected Result**: Logs tab is visible and displays streaming content
4. **Verify log formatting**:
   - **stdout entries**: White text, no prefix
   - **stderr entries**: Amber text (`text-amber-400`), prefixed with `[err]`
   - **system entries**: Slate text (`text-slate-400`), prefixed with `[sys]` in italic
5. **Expected Result**: Logs auto-scroll to bottom as new entries arrive
6. **Expected Result**: Monospace font on dark background (`bg-slate-950`)

**Failure Indicators**:
- Logs don't stream (static content only)
- Wrong text colors or formatting
- Logs don't auto-scroll
- Missing log type prefixes

### Criterion 20: Task Actions

**Objective**: Verify cancel and retry actions work correctly

**Prerequisites**: Task that can be cancelled or retried

**Steps**:
1. Open Task Detail screen for a cancellable task
2. Look for "Cancel" action button
3. Tap "Cancel" button
4. **Expected Result**: Confirmation alert appears
5. Confirm cancellation
6. **Expected Result**: Task status updates to "cancelled"
7. **For retry testing**: Find a failed task
8. Tap "Retry" action
9. **Expected Result**: Confirmation alert appears
10. Confirm retry
11. **Expected Result**: New task instance created with "queued" status

**Failure Indicators**:
- Action buttons don't appear
- Confirmation dialogs don't show
- Actions don't actually execute
- Status doesn't update after action

### Criterion 21: Push Notification Navigation

**Objective**: Verify push notifications navigate to correct screens

**Prerequisites**:
- Push notifications enabled in app settings
- Expo push token registered
- Task completion or failure event

**Setup Steps**:
1. Go to Settings tab
2. Ensure notification toggles are enabled
3. Trigger a task completion (let a task finish naturally)

**Test Steps**:
1. **Wait for push notification** to arrive (may take 1-2 minutes)
2. **Tap the notification** when it appears
3. **Expected Result**: App opens and navigates directly to Task Detail screen
4. **Expected Result**: Correct task is displayed (matching notification content)
5. **Repeat for different notification types**:
   - Task completion
   - Task failure
   - Blocker escalation
   - Plan approval

**Failure Indicators**:
- Notifications don't arrive
- Tapping notification doesn't open app
- Wrong screen or task displayed
- Deep linking fails

### Criterion 22: Biometric Authentication Flow

**Objective**: Verify biometric unlock and fallback behavior

**Prerequisites**: Device with biometric capability (fingerprint, face unlock)

**Initial Setup**:
1. Sign in with email/password
2. When prompted "Use Face ID / fingerprint to unlock WorkerMill?", tap "Enable"
3. Complete biometric enrollment if needed
4. Close app completely (swipe away from recent apps)

**Test Steps**:
1. **Launch app** (cold start)
2. **Expected Result**: Biometric prompt appears immediately
3. **Use valid biometric** (fingerprint, face)
4. **Expected Result**: App unlocks and shows Dashboard tab
5. **Test failure scenario**:
   - Close app again
   - Launch app
   - **Fail biometric authentication 3 times** (wrong finger, look away, etc.)
   - **Expected Result**: After 3rd failure, app shows full sign-in screen
   - **Complete sign-in** with email/password
   - **Expected Result**: Biometric counter resets (next launch shows biometric prompt again)

**Failure Indicators**:
- Biometric prompt doesn't appear
- Valid biometric doesn't unlock app
- Failure counter doesn't work correctly
- Sign-in screen appears immediately instead of biometric

### Criterion 23: Performance - App Launch Time (< 2 seconds)

**Objective**: Measure app launch performance using Android GPU Profiler

**Prerequisites**:
- Android GPU Profiler installed
- Device connected via ADB
- App closed completely
- Cached task data exists from previous session

**Setup Android GPU Profiler**:
1. Open Android Studio
2. Go to View → Tool Windows → Profiler
3. Connect to your device
4. Select WorkerMill app process (if not visible, launch app first then stop)

**Test Steps**:
1. **Ensure app is completely closed** (swipe away from recent apps)
2. **Start GPU Profiler recording**:
   - In Profiler, click "+" to add new session
   - Select your device and WorkerMill app
   - Click on GPU profiling section
3. **Cold start the app** by tapping app icon
4. **Watch for Dashboard FlatList rendering**:
   - Time from app icon tap to first task row visible
   - OR time to EmptyState component if zero tasks
5. **Stop recording** once Dashboard is fully loaded
6. **Measure frame timeline**:
   - In GPU Profiler, examine the frame rendering timeline
   - Identify the frame where first task list item renders
   - **Expected Result**: This frame appears within 2000ms of app start

**Evidence Collection**:
- Take screenshot of GPU Profiler timeline showing < 2s measurement
- Note exact timing in test results

**Failure Indicators**:
- Dashboard takes > 2 seconds to show first content
- App hangs on splash screen
- Crashes during launch

### Criterion 24: Performance - Scroll Smoothness (60fps)

**Objective**: Verify task list maintains 60fps during scrolling

**Prerequisites**:
- 20+ tasks in Dashboard task list
- Android GPU Profiler setup (same as Criterion 23)

**Test Steps**:
1. **Navigate to Dashboard** with 20+ task items
2. **Start GPU Profiler recording** with focus on "Render" track
3. **Scroll task list continuously for 10 seconds**:
   - Use smooth, consistent scroll gestures
   - Scroll both up and down
   - Vary scroll speed (slow, medium, fast)
4. **Stop recording** after 10 seconds
5. **Analyze frame delivery**:
   - In Profiler, examine the "Render" track timeline
   - Look for frame drops below 60fps
   - **Expected Result**: No more than 2 consecutive dropped frames during entire scroll period
   - **Acceptable**: Occasional single frame drops
   - **Failure**: Sustained periods below 60fps or frequent stuttering

**Evidence Collection**:
- Screenshot of GPU Profiler render timeline showing 60fps maintenance
- Note any significant frame drops and their duration

**Failure Indicators**:
- Visible stuttering or jank during scroll
- GPU Profiler shows sustained frame rate drops
- List doesn't respond smoothly to touch input

### Criterion 25: Manual APK Build via GitHub Actions

**Objective**: Verify GitHub Actions workflow produces downloadable APK

**Prerequisites**:
- GitHub access to workermill repository
- EXPO_TOKEN secret configured in repository settings

**Test Steps**:
1. **Navigate to GitHub repository** → Actions tab
2. **Find "Mobile Build" workflow**
3. **Click "Run workflow" button**
4. **Select branch** (usually main or current feature branch)
5. **Click green "Run workflow" button**
6. **Monitor workflow execution**:
   - Expected: All steps complete successfully (green checkmarks)
   - Build time varies based on EAS queue (typically 5-15 minutes)
7. **Download APK artifact**:
   - Once workflow completes, look for "Artifacts" section
   - Download the Android APK file
   - **Expected Result**: APK downloads successfully and installs on device

**Success Criteria**:
- Workflow runs without errors
- APK artifact is produced
- APK can be installed on test device
- **Note**: Build duration is not measured - only success/failure

**Failure Indicators**:
- Workflow fails with error messages
- No APK artifact produced
- APK fails to install or is corrupted

## Common Issues and Troubleshooting

### SSE Connection Issues
- **Symptom**: Offline banner appears immediately or frequently
- **Check**: Device internet connection and firewall settings
- **Verify**: Can access https://workermill.com/api/health in device browser

### Push Notifications Not Received
- **Check**: App notification permissions in device settings
- **Check**: WorkerMill Settings tab - notification toggles enabled
- **Verify**: Expo push token registration succeeded (check logs)

### Biometric Authentication Fails
- **Check**: Device biometric settings and enrolled fingerprints/face
- **Verify**: App has biometric permissions in device settings
- **Test**: Other apps using biometric authentication work correctly

### Performance Issues
- **Check**: Device has sufficient free storage and memory
- **Verify**: No other intensive apps running in background
- **Test**: Close and restart app to clear memory

### APK Installation Issues
- **Check**: "Unknown sources" or "Install from file" enabled in device settings
- **Verify**: APK file downloaded completely (not corrupted)
- **Try**: Uninstall previous version before installing new APK

## Test Environment Notes

- **Production API**: All tests use https://workermill.com/api (no staging environment)
- **Network dependency**: Most tests require active internet connection
- **Device variation**: Test on different Android versions when possible (API 24+)
- **Performance baseline**: Results may vary by device specifications

## Documentation Updates

When updating this testing guide:
1. **Add new criteria** in numerical order (26, 27, etc.)
2. **Include prerequisites** and setup steps for each test
3. **Specify expected results** vs. failure indicators clearly
4. **Update troubleshooting section** with new known issues
5. **Maintain evidence collection** requirements for performance tests

## Test Report Template

When conducting these tests, document results in this format:

```
## Test Session Report
- **Date**: [YYYY-MM-DD]
- **Tester**: [Name]
- **Device**: [Model/Android Version]
- **APK Version**: [Build number/commit hash]
- **Test Duration**: [Start-End time]

### Results Summary
- **Passed**: [X/25 criteria]
- **Failed**: [Y criteria numbers]
- **Blocked**: [Z criteria - unable to test]

### Failed Tests Detail
[For each failed test, include:]
- **Criterion**: [Number and title]
- **Failure symptoms**: [What went wrong]
- **Expected vs Actual**: [Specific differences]
- **Screenshots/Evidence**: [Attach files]

### Performance Evidence
- **App Launch Time**: [Measured value] - PASS/FAIL
- **Scroll Performance**: [Frame rate analysis] - PASS/FAIL
- **GPU Profiler Screenshots**: [Attach timeline images]
```