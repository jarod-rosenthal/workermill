# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

**Email:** security@workermill.com

Do NOT open a public GitHub issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on main | Yes |
| Previous releases | Best effort |

## Security Practices

- All secrets loaded from environment variables (never hardcoded)
- Cognito JWT authentication for API access
- API key authentication with bcrypt hashing for worker communication
- Rate limiting on all endpoints
- CORS configured for known origins
- Helmet security headers
- Input validation via express-validator
- Encrypted credential storage (TypeORM subscriber)
