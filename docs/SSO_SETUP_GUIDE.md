# SSO Provider Setup Guide

WorkerMill supports Single Sign-On (SSO) with popular identity providers via AWS Cognito. This guide covers setup for each supported provider.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Google SSO](#google-sso)
- [Microsoft SSO](#microsoft-sso)
- [Apple SSO](#apple-sso-future)
- [Facebook SSO](#facebook-sso-future)
- [SAML/Enterprise SSO](#samlenterprise-sso-future)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

```
User clicks "Sign in with Google" on workermill.com/login
    ↓
Redirect to Cognito hosted UI with identity_provider=Google
    ↓
Cognito redirects to Google for authentication
    ↓
User logs in with Google credentials
    ↓
Google redirects back to Cognito with authorization code
    ↓
Cognito creates/links user and redirects to workermill.com/auth/callback
    ↓
Frontend exchanges code for tokens via /api/auth/sso-callback
    ↓
User is logged in and redirected to dashboard
```

### Key URLs

| Environment | Cognito Domain | OAuth Callback URL |
|-------------|----------------|-------------------|
| Production | `workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com` | `https://workermill.com/auth/callback` |
| Development | `workermill-sandbox-*.auth.us-east-1.amazoncognito.com` | `https://dev.workermill.com/auth/callback` |

---

## Google SSO

### Step 1: Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Select your project or create a new one
3. Click **Create Credentials** → **OAuth client ID**
4. Select **Web application** as the application type
5. Configure:
   - **Name**: `WorkerMill SSO`
   - **Authorized JavaScript origins**:
     - `https://workermill.com`
     - `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com`
   - **Authorized redirect URIs**:
     - `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### Step 2: Configure OAuth Consent Screen

1. Go to **OAuth consent screen** in Google Cloud Console
2. Select **External** user type (or Internal if only for your organization)
3. Fill in required fields:
   - App name: `WorkerMill`
   - User support email: Your email
   - Developer contact email: Your email
4. Add scopes:
   - `email`
   - `profile`
   - `openid`
5. Save and continue

### Step 3: Deploy to WorkerMill

```bash
cd infrastructure/terraform/environments/prod

# Apply with Google credentials
terraform apply \
  -var="google_client_id=YOUR_GOOGLE_CLIENT_ID" \
  -var="google_client_secret=YOUR_GOOGLE_CLIENT_SECRET"
```

Alternatively, set these in a `terraform.tfvars` file (don't commit to git!):

```hcl
google_client_id     = "xxx.apps.googleusercontent.com"
google_client_secret = "GOCSPX-xxxxx"
```

### Step 4: Deploy API to Pick Up Changes

```bash
./deploy.sh --api
```

---

## Microsoft SSO

Microsoft SSO uses Azure Active Directory (now Microsoft Entra ID) via OIDC.

### Step 1: Register Application in Azure

1. Go to [Azure Portal](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Configure:
   - **Name**: `WorkerMill SSO`
   - **Supported account types**: Choose based on your needs:
     - **Single tenant**: Only users from your organization
     - **Multi-tenant**: Users from any Azure AD organization
     - **Personal accounts**: Microsoft personal accounts (outlook.com, etc.)
   - **Redirect URI**:
     - Platform: **Web**
     - URI: `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
4. Click **Register**
5. Copy the **Application (client) ID** and **Directory (tenant) ID**

### Step 2: Create Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and expiration
4. Copy the **Value** immediately (it won't be shown again)

### Step 3: Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. Add:
   - `email`
   - `openid`
   - `profile`
4. Click **Grant admin consent** (if you have admin rights)

### Step 4: Deploy to WorkerMill

```bash
cd infrastructure/terraform/environments/prod

terraform apply \
  -var="microsoft_client_id=YOUR_APPLICATION_ID" \
  -var="microsoft_client_secret=YOUR_CLIENT_SECRET" \
  -var="microsoft_tenant_id=YOUR_TENANT_ID"
```

For multi-tenant apps, use `microsoft_tenant_id = "common"`.

### Step 5: Deploy API

```bash
./deploy.sh --api
```

---

## Apple SSO (Future)

Apple Sign In requires an Apple Developer account ($99/year).

### Prerequisites

- Apple Developer Program membership
- Access to Certificates, Identifiers & Profiles

### Step 1: Create App ID

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list)
2. Click **+** to create a new identifier
3. Select **App IDs** and continue
4. Configure:
   - **Description**: `WorkerMill`
   - **Bundle ID**: `com.workermill.web` (example)
5. Under Capabilities, enable **Sign in with Apple**

### Step 2: Create Services ID

1. Create another identifier of type **Services IDs**
2. Configure:
   - **Identifier**: `com.workermill.web.signin`
   - Enable **Sign in with Apple**
3. Configure the Web Authentication:
   - **Domains**: `workermill.com`
   - **Return URLs**: `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`

### Step 3: Create Private Key

1. Go to **Keys** and create a new key
2. Enable **Sign in with Apple**
3. Download the private key file (`.p8`)
4. Note the **Key ID**

### Step 4: Terraform Configuration (Future)

```hcl
# variables.tf additions (when implemented)
variable "apple_team_id" {
  description = "Apple Developer Team ID"
  type        = string
  default     = ""
}

variable "apple_services_id" {
  description = "Apple Services ID for Sign in with Apple"
  type        = string
  default     = ""
}

variable "apple_key_id" {
  description = "Apple Key ID for Sign in with Apple"
  type        = string
  default     = ""
}

variable "apple_private_key" {
  description = "Apple private key file contents (PEM format)"
  type        = string
  default     = ""
  sensitive   = true
}
```

---

## Facebook SSO (Future)

### Step 1: Create Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/apps/)
2. Click **Create App**
3. Select **Consumer** as the app type
4. Configure basic settings

### Step 2: Add Facebook Login

1. In your app dashboard, add **Facebook Login** product
2. Configure:
   - **Valid OAuth Redirect URIs**: `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
   - Enable **Client OAuth Login**
   - Enable **Web OAuth Login**

### Step 3: Get Credentials

- **App ID**: Found in app dashboard
- **App Secret**: Found in Settings → Basic

### Step 4: Terraform Configuration (Future)

```hcl
variable "facebook_client_id" {
  description = "Facebook App ID"
  type        = string
  default     = ""
}

variable "facebook_client_secret" {
  description = "Facebook App Secret"
  type        = string
  default     = ""
  sensitive   = true
}
```

---

## SAML/Enterprise SSO (Future)

For enterprise customers needing Okta, Azure AD SAML, or other SAML providers.

### Cognito SAML Configuration

Cognito supports SAML 2.0 identity providers. Configuration requires:

1. **Metadata URL or XML**: From your identity provider
2. **Attribute mapping**: Map SAML assertions to Cognito attributes

### Example Okta SAML Setup

1. In Okta Admin Console, create a new SAML 2.0 application
2. Configure:
   - **Single Sign-On URL**: `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com/saml2/idpresponse`
   - **Audience URI**: `urn:amazon:cognito:sp:COGNITO_POOL_ID`
   - **Name ID format**: EmailAddress
3. Add attribute statements:
   - `email` → `user.email`
   - `name` → `user.displayName`

### Terraform SAML Provider (Future)

```hcl
resource "aws_cognito_identity_provider" "okta" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Okta"
  provider_type = "SAML"

  provider_details = {
    MetadataURL = "https://your-org.okta.com/app/xxxx/sso/saml/metadata"
  }

  attribute_mapping = {
    email = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    name  = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
  }
}
```

---

## Troubleshooting

### Common Issues

#### "redirect_mismatch" Error

The OAuth redirect URI doesn't match. Ensure you've configured:
- In provider (Google/Microsoft): `https://workermill-dev-x0ru7n3p.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- In Cognito callback URLs: `https://workermill.com/auth/callback`

#### "invalid_client" Error

- Check client ID and secret are correct
- For Microsoft: Verify the tenant ID matches your configuration
- Ensure no extra spaces in credentials

#### User Not Created in Database

Check API logs for provisioning errors:
```bash
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1
```

#### SSO Buttons Not Appearing

1. Verify providers are configured in Cognito:
   ```bash
   aws cognito-idp list-identity-providers \
     --user-pool-id COGNITO_POOL_ID \
     --region us-east-1
   ```

2. Check API `/auth/sso-config` endpoint:
   ```bash
   curl https://workermill.com/api/auth/sso-config
   ```

### Logs and Debugging

```bash
# API logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

# Check Cognito configuration
aws cognito-idp describe-user-pool \
  --user-pool-id COGNITO_POOL_ID \
  --region us-east-1

# List identity providers
aws cognito-idp list-identity-providers \
  --user-pool-id COGNITO_POOL_ID \
  --region us-east-1
```

---

## Security Considerations

1. **Client secrets**: Store securely, never commit to git
2. **Terraform state**: Use remote state with encryption (S3 + DynamoDB)
3. **Scope minimization**: Only request necessary OAuth scopes
4. **Token validation**: Cognito handles JWT validation
5. **User provisioning**: Users are auto-provisioned on first SSO login

## Adding a New Provider

To add a new provider:

1. **Terraform module** (`modules/cognito/main.tf`):
   - Add variables for credentials
   - Add `aws_cognito_identity_provider` resource
   - Add to `local.identity_providers` list

2. **Frontend** (`Login.tsx`):
   - Add provider icon
   - Provider will automatically appear if configured

3. **Documentation**: Update this guide with setup instructions
