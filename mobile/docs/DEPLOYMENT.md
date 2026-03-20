# WorkerMill Mobile App - Deployment Guide

## Go-Live Checklist

This document provides the complete go-live checklist for deploying the WorkerMill mobile application to production. Follow this checklist step-by-step to ensure a successful deployment.

### Prerequisites

Before starting the deployment process, ensure all development and testing phases are complete and all acceptance criteria have been met.

## 1. GitHub Secrets Verification

### Required Secrets

Verify that the following GitHub secrets are properly configured in the repository:

#### EXPO_TOKEN
- **Location**: Repository Settings → Secrets and variables → Actions
- **Purpose**: EAS CLI authentication for cloud builds
- **Verification**:
  1. Navigate to GitHub repository settings
  2. Go to "Secrets and variables" → "Actions"
  3. Confirm `EXPO_TOKEN` is present in the repository secrets list
  4. Value should be a valid Expo access token from expo.dev

**How to obtain EXPO_TOKEN:**
1. Visit [expo.dev](https://expo.dev)
2. Log in to your Expo account
3. Go to Account Settings → Access Tokens
4. Create a new token with appropriate permissions
5. Copy the token value and add it as `EXPO_TOKEN` secret in GitHub

## 2. Environment Configuration Verification

### COGNITO_CLIENT_ID Configuration

Verify that the Cognito Client ID is properly set in the mobile app configuration:

#### Check Configuration File
- **File**: `mobile/constants/config.ts`
- **Line**: `COGNITO_CLIENT_ID` export
- **Requirement**: Must NOT contain the placeholder string `<REPLACE_WITH_CLIENT_ID>`

**Verification Steps:**
```bash
cd mobile
grep -r "<REPLACE_WITH_CLIENT_ID>" .
```
- If the command returns any results, the placeholder has not been replaced
- The value should be set via `EXPO_PUBLIC_COGNITO_CLIENT_ID` environment variable or fallback to a valid client ID

**How to find the correct COGNITO_CLIENT_ID:**
1. Access AWS Console
2. Navigate to Amazon Cognito
3. Select User Pools
4. Find the WorkerMill user pool
5. Go to App integration → App clients
6. Copy the App client ID for the WorkerMill web/mobile client

## 3. Build Configuration Verification

### EAS Configuration Check

Verify the EAS build configuration is properly set:

#### eas.json Verification
- **File**: `mobile/eas.json`
- **CLI Version**: Must be pinned to `>= 12.0.0 < 13.0.0`
- **Build Profiles**: Must include `preview` profile for APK generation

#### GitHub Actions Workflow Verification
- **File**: `.github/workflows/mobile-build.yml`
- **Critical Requirement**: Must ONLY have `workflow_dispatch` trigger
- **Verification**: Ensure no `push:` triggers are present in the workflow

**Verification Commands:**
```bash
# Check for unwanted push triggers
grep -n "push:" .github/workflows/mobile-build.yml
# This command should return NO results

# Verify workflow_dispatch is present
grep -n "workflow_dispatch:" .github/workflows/mobile-build.yml
# This should return the workflow_dispatch trigger line
```

## 4. Pre-Build Quality Gates

Before triggering a production build, run all quality gate commands to ensure code quality:

### TypeScript Compilation
```bash
cd mobile && npx tsc --noEmit
```
- Must exit with code 0 and show no TypeScript errors

### Linting
```bash
cd mobile && npx expo lint
```
- Must pass with no critical linting errors

### Unit Tests
```bash
cd mobile && npx jest --passWithNoTests
```
- All unit tests must pass

### Placeholder Guard
```bash
grep -r "<REPLACE_WITH_CLIENT_ID>" mobile/
```
- Command must exit non-zero (i.e., no placeholder strings found)

### API Quality Gates (if backend changes were made)
```bash
cd api && npm run typecheck
cd api && npx vitest run src/routes/push.test.ts
cd api && npx vitest run src/services/push-notifications.test.ts
```

## 5. Manual Build Trigger

### Triggering the Build via GitHub Actions

1. **Navigate to GitHub Actions**:
   - Go to your repository on GitHub
   - Click on the "Actions" tab
   - Find the "Mobile Build" workflow

2. **Manual Trigger**:
   - Click on "Mobile Build" workflow
   - Click the "Run workflow" button
   - Select build parameters:
     - **Platform**: `android` (for APK) or `ios` (for IPA)
     - **Profile**: `preview` (for testing) or `production` (for store submission)
   - Click "Run workflow" to start the build

3. **Monitor Build Progress**:
   - The workflow will appear in the runs list
   - Click on the running workflow to view detailed logs
   - Build typically takes 10-20 minutes depending on EAS queue

4. **Build Completion**:
   - Successful builds will show a green checkmark
   - Failed builds will show a red X with error logs

## 6. APK Download and Distribution

### Downloading the APK

1. **From EAS Dashboard**:
   - Visit [expo.dev](https://expo.dev)
   - Navigate to your project dashboard
   - Go to "Builds" section
   - Find the completed build
   - Click "Download" to get the APK file

2. **From GitHub Actions** (if configured):
   - Go to the completed workflow run
   - Check the "Artifacts" section for downloadable files
   - Download the APK artifact

### APK Distribution Methods

#### Option 1: Direct Device Installation
1. **Transfer APK to device**:
   - Email the APK to yourself and open on Android device
   - Upload to cloud storage (Google Drive, Dropbox) and download on device
   - Transfer via USB cable

2. **Enable Unknown Sources**:
   - Go to Settings → Security (or Apps & notifications)
   - Enable "Install unknown apps" for the app you're using to install (Chrome, Files app, etc.)

3. **Install APK**:
   - Tap the downloaded APK file
   - Follow the installation prompts
   - Grant any required permissions

#### Option 2: Internal Distribution
1. **Google Play Console Internal Testing**:
   - Upload APK to Google Play Console
   - Set up internal testing track
   - Invite testers via email
   - Testers install via Play Store link

2. **Firebase App Distribution**:
   - Upload APK to Firebase App Distribution
   - Invite testers via email
   - Testers install via Firebase distribution link

## 7. Device Installation Steps

### Android Device Installation

#### Prerequisites
- Android device running Android 7.0 (API level 24) or higher
- Device must allow installation from unknown sources
- Sufficient storage space (approximately 50-100 MB)

#### Installation Process
1. **Download APK**:
   ```bash
   # Example download command (if using direct URL)
   wget [APK_DOWNLOAD_URL] -O workermill.apk
   ```

2. **Transfer to Device**:
   - Via ADB: `adb install workermill.apk`
   - Via file transfer: Copy APK to device downloads folder

3. **Install on Device**:
   - Open file manager on Android device
   - Navigate to Downloads folder
   - Tap on `workermill.apk`
   - If prompted, allow installation from this source
   - Tap "Install"
   - Wait for installation to complete
   - Tap "Open" or find the app in the app drawer

#### Post-Installation Verification
1. **App Launch**: Verify the app launches successfully
2. **Sign-In**: Test authentication flow
3. **Core Functions**: Verify main features work as expected
4. **Push Notifications**: Test notification delivery (if configured)

### iOS Device Installation (Future)

iOS installation requires:
- Apple Developer account ($99/year)
- Device UDID registration for ad-hoc builds
- TestFlight for broader distribution

*iOS deployment will be available when Apple Developer account is configured.*

## 8. Production Environment Validation

### Post-Deployment Checklist

After successful installation, verify the following:

#### Authentication
- [ ] Email/password sign-in works
- [ ] SSO providers (GitHub, Google, Microsoft) function correctly
- [ ] Biometric unlock (if enabled) works properly
- [ ] Token refresh happens automatically

#### Core Functionality
- [ ] Dashboard loads and displays real-time task updates
- [ ] Boards tab shows correct data
- [ ] Task detail screens load properly
- [ ] Real-time updates via SSE work correctly
- [ ] Push notifications are delivered (if configured)

#### Performance Targets
- [ ] App launch to dashboard visible: < 2 seconds (with cached data)
- [ ] Task list scrolling: 60fps performance
- [ ] SSE reconnection after network loss: < 5 seconds

#### Network Conditions
- [ ] App functions correctly on WiFi
- [ ] App functions correctly on mobile data
- [ ] Offline behavior works as expected (cached data display)
- [ ] Network reconnection handled gracefully

## 9. Rollback Procedures

### If Issues Are Discovered

#### Immediate Actions
1. **Stop Distribution**: Remove download links, revoke access
2. **Document Issues**: Record all discovered problems
3. **Notify Stakeholders**: Alert team of rollback decision

#### Rollback Options
1. **Previous Version**: Revert to previously known-good APK
2. **Hotfix Build**: Create emergency build with critical fixes
3. **Feature Flags**: Disable problematic features remotely (if implemented)

### Emergency Contacts
- **Development Team**: [Contact information]
- **DevOps Team**: [Contact information]
- **Product Owner**: [Contact information]

## 10. Monitoring and Observability

### Post-Deployment Monitoring

#### Application Performance
- Monitor app crash rates via crash reporting tools
- Track user adoption and retention metrics
- Monitor API error rates and response times

#### Infrastructure Monitoring
- EAS build success rates
- CDN performance for app distribution
- Authentication service health

#### User Feedback Channels
- App store reviews (when published)
- Internal feedback channels
- Support ticket system

## 11. Documentation and Knowledge Transfer

### Required Documentation Updates
- [ ] Update deployment runbook with lessons learned
- [ ] Document any configuration changes made during deployment
- [ ] Update troubleshooting guide with new known issues
- [ ] Update user onboarding documentation

### Team Knowledge Transfer
- [ ] Conduct deployment retrospective meeting
- [ ] Share deployment experience with broader team
- [ ] Update deployment automation for future releases

## Conclusion

This deployment guide ensures a systematic and safe deployment of the WorkerMill mobile application. Each step includes verification procedures to catch potential issues early and ensure a successful go-live experience.

**Remember**: Always run through this entire checklist for production deployments, even if some steps seem redundant. The systematic approach helps prevent deployment issues and ensures a consistent, reliable deployment process.

For questions or issues during deployment, refer to the emergency contacts section and escalate as needed.