"""
Cognito Pre-Sign-Up Lambda Trigger

Validates that a user has a pending invitation before allowing account creation.
This ensures only invited users can sign up to the platform.

Returns:
    - Success: Allows Cognito to create the account
    - PreSignUpException: Blocks account creation with user-friendly message
"""

import json
import logging
import os
import ssl

import boto3
import pg8000

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Cache database connection across invocations
_db_connection = None


def get_db_credentials():
    """Fetch database credentials from AWS Secrets Manager."""
    secret_arn = os.environ.get("DB_CREDENTIALS_SECRET_ARN")

    if secret_arn:
        client = boto3.client("secretsmanager")
        response = client.get_secret_value(SecretId=secret_arn)
        return json.loads(response["SecretString"])

    # Fallback to environment variables
    return {
        "host": os.environ["DB_HOST"],
        "port": int(os.environ.get("DB_PORT", 5432)),
        "database": os.environ["DB_NAME"],
        "username": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
    }


def get_db_connection():
    """Get or create a database connection with connection pooling."""
    global _db_connection

    if _db_connection is not None:
        try:
            # Test if connection is still alive
            cursor = _db_connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            return _db_connection
        except Exception:
            _db_connection = None

    creds = get_db_credentials()

    # Create SSL context for RDS
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    _db_connection = pg8000.connect(
        host=creds["host"],
        port=creds.get("port", 5432),
        database=creds.get("database", "workermill"),
        user=creds["username"],
        password=creds["password"],
        ssl_context=ssl_context,
        timeout=10,
    )

    return _db_connection


def check_invite_exists(email: str) -> bool:
    """
    Check if a valid (non-expired, non-accepted) invite exists for the email.

    Args:
        email: The email address to check

    Returns:
        True if a valid invite exists, False otherwise
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    query = """
        SELECT COUNT(*)
        FROM org_invites
        WHERE LOWER(email) = LOWER(%s)
          AND accepted = false
          AND expires_at > NOW()
    """

    cursor.execute(query, (email,))
    result = cursor.fetchone()
    count = result[0] if result else 0

    logger.info(f"Invite check for {email}: found {count} valid invite(s)")

    return count > 0


def check_user_exists(email: str) -> bool:
    """
    Check if the user already exists in our database.

    This handles the case where a Cognito account was deleted but the
    user record still exists in our database.

    Args:
        email: The email address to check

    Returns:
        True if user exists, False otherwise
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    query = """
        SELECT COUNT(*)
        FROM users
        WHERE LOWER(email) = LOWER(%s)
    """

    cursor.execute(query, (email,))
    result = cursor.fetchone()
    count = result[0] if result else 0

    return count > 0


def lambda_handler(event, context):
    """
    Cognito Pre-Sign-Up trigger handler.

    Event structure:
    {
        "version": "1",
        "region": "us-east-1",
        "userPoolId": "us-east-1_xxxxx",
        "userName": "user-uuid",
        "callerContext": {...},
        "triggerSource": "PreSignUp_SignUp",
        "request": {
            "userAttributes": {
                "email": "user@example.com"
            }
        },
        "response": {
            "autoConfirmUser": false,
            "autoVerifyEmail": false,
            "autoVerifyPhone": false
        }
    }

    Returns:
        Modified event with response flags

    Raises:
        Exception: If user doesn't have a valid invitation
    """
    logger.info(f"Pre-sign-up trigger invoked: {json.dumps(event, default=str)}")

    trigger_source = event.get("triggerSource", "")

    # Only check invites for standard sign-ups, not admin-created users or external providers
    # PreSignUp_SignUp: Regular sign-up
    # PreSignUp_ExternalProvider: OAuth/SAML sign-up (Google, Microsoft)
    # PreSignUp_AdminCreateUser: Admin-created user
    if trigger_source not in ["PreSignUp_SignUp", "PreSignUp_ExternalProvider"]:
        logger.info(f"Skipping invite check for trigger source: {trigger_source}")
        return event

    try:
        email = event["request"]["userAttributes"].get("email", "").lower()

        if not email:
            logger.error("No email provided in sign-up request")
            raise Exception("Email address is required")

        # Check if user already exists in our database (re-signup scenario)
        if check_user_exists(email):
            logger.info(f"User {email} already exists in database, allowing sign-up")
            event["response"]["autoConfirmUser"] = True
            event["response"]["autoVerifyEmail"] = True
            return event

        # Check for valid invitation
        if not check_invite_exists(email):
            logger.warning(f"Sign-up blocked: No valid invitation for {email}")
            raise Exception(
                "WorkerMill is invite-only. Please contact your organization administrator "
                "to request an invitation."
            )

        logger.info(f"Sign-up allowed: Valid invitation found for {email}")

        # Auto-confirm the user since they have a valid invite
        # This skips the email verification step (invite link already verified ownership)
        event["response"]["autoConfirmUser"] = True
        event["response"]["autoVerifyEmail"] = True

        return event

    except Exception as e:
        logger.error(f"Pre-sign-up check failed: {str(e)}")
        # Re-raise to block sign-up with the error message
        raise
