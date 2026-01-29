import { Link } from "react-router-dom";
import { ArrowLeft, Lock, Server, Shield, Eye, Users, AlertTriangle, Mail } from "lucide-react";
import { ThemeToggle } from "../../components/ThemeToggle";

const SECURITY_VERSION = "2026-01-28";

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
}

const sections: Section[] = [
  { id: "infrastructure", title: "Infrastructure Security", icon: <Server className="w-4 h-4" /> },
  { id: "application", title: "Application Security", icon: <Lock className="w-4 h-4" /> },
  { id: "data-protection", title: "Data Protection", icon: <Shield className="w-4 h-4" /> },
  { id: "worker-isolation", title: "Worker Isolation", icon: <Users className="w-4 h-4" /> },
  { id: "audit", title: "Audit & Compliance", icon: <Eye className="w-4 h-4" /> },
  { id: "incident-response", title: "Incident Response", icon: <AlertTriangle className="w-4 h-4" /> },
  { id: "disclosure", title: "Responsible Disclosure", icon: <Mail className="w-4 h-4" /> },
];

export default function Security() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              WorkerMill
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground text-sm font-semibold rounded-lg hover:shadow-lg hover:shadow-primary/25 transition-all duration-300"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex pt-16">
        {/* Sidebar Navigation */}
        <aside className="hidden lg:block w-64 fixed top-16 left-0 h-[calc(100vh-4rem)] border-r border-border bg-card/50 overflow-y-auto">
          <div className="p-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-foreground">Security</h2>
            </div>
            <nav className="space-y-1">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`***REMOVED***${section.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
                >
                  {section.icon}
                  {section.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:ml-64">
          <div className="max-w-4xl mx-auto px-6 py-12">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">Security</h1>
              <p className="text-sm text-muted-foreground">
                Last updated: {SECURITY_VERSION}
              </p>
            </div>

            {/* Security Overview Card */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-12">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-8 h-8 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">Security at WorkerMill</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Security is foundational to WorkerMill. We implement multiple layers of protection to
                safeguard your code, data, and credentials. This page outlines our security practices
                and commitments.
              </p>
            </div>

            <div className="prose prose-slate dark:prose-invert max-w-none space-y-12">
              {/* Section 1: Infrastructure Security */}
              <section id="infrastructure" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <Server className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Infrastructure Security</h2>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">Cloud Infrastructure</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  WorkerMill runs on Amazon Web Services (AWS), leveraging their world-class security
                  infrastructure and compliance certifications.
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>Region:</strong> US East (N. Virginia) - us-east-1</li>
                  <li><strong>Compute:</strong> AWS ECS Fargate (serverless containers)</li>
                  <li><strong>Database:</strong> AWS RDS PostgreSQL with encryption at rest</li>
                  <li><strong>Storage:</strong> AWS S3 with server-side encryption</li>
                  <li><strong>CDN:</strong> AWS CloudFront with HTTPS enforcement</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Network Security</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li><strong>VPC Isolation:</strong> Services run in private subnets with no direct internet access</li>
                  <li><strong>Security Groups:</strong> Strictly scoped inbound/outbound rules</li>
                  <li><strong>TLS Encryption:</strong> All traffic encrypted in transit (TLS 1.2+)</li>
                  <li><strong>WAF:</strong> Web Application Firewall for API protection</li>
                </ul>
              </section>

              {/* Section 2: Application Security */}
              <section id="application" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <Lock className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Application Security</h2>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">Authentication</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>AWS Cognito:</strong> Enterprise-grade identity management</li>
                  <li><strong>MFA Support:</strong> Multi-factor authentication available</li>
                  <li><strong>OAuth 2.0:</strong> Secure integration with GitHub, Jira, etc.</li>
                  <li><strong>Session Management:</strong> Secure JWT tokens with automatic refresh</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Authorization</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>Role-Based Access Control:</strong> Admin, Member, and Viewer roles</li>
                  <li><strong>Organization Isolation:</strong> Strict multi-tenant data separation</li>
                  <li><strong>API Keys:</strong> Hashed storage, scoped permissions, revocable</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">API Security</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li><strong>Input Validation:</strong> All inputs validated and sanitized</li>
                  <li><strong>Rate Limiting:</strong> Protection against abuse and DDoS</li>
                  <li><strong>Webhook Signatures:</strong> HMAC verification for all webhooks</li>
                  <li><strong>CORS:</strong> Strict origin policies</li>
                </ul>
              </section>

              {/* Section 3: Data Protection */}
              <section id="data-protection" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <Shield className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Data Protection</h2>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">Encryption</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>At Rest:</strong> AES-256 encryption for all stored data</li>
                  <li><strong>In Transit:</strong> TLS 1.2+ for all network communication</li>
                  <li><strong>API Keys:</strong> Bcrypt hashed, never stored in plaintext</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Secrets Management</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>AWS Secrets Manager:</strong> Secure storage for all credentials</li>
                  <li><strong>Environment Isolation:</strong> Separate secrets per environment</li>
                  <li><strong>No Hardcoded Secrets:</strong> Zero credentials in code or config files</li>
                  <li><strong>Automatic Rotation:</strong> Support for credential rotation</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Multi-Tenant Isolation</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li><strong>Organization Scoping:</strong> All queries enforced with org_id</li>
                  <li><strong>Data Separation:</strong> No cross-organization data access possible</li>
                  <li><strong>Audit Trail:</strong> All data access logged for compliance</li>
                </ul>
              </section>

              {/* Section 4: Worker Isolation */}
              <section id="worker-isolation" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <Users className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Worker Isolation</h2>
                </div>

                <p className="text-muted-foreground leading-relaxed mb-4">
                  AI workers execute in isolated, ephemeral containers with strict security boundaries:
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Container Security</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>Ephemeral:</strong> Containers destroyed immediately after task completion</li>
                  <li><strong>No Persistence:</strong> No local storage retained between tasks</li>
                  <li><strong>Fresh Environment:</strong> Each task starts with a clean container image</li>
                  <li><strong>Resource Limits:</strong> CPU, memory, and time limits enforced</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Network Isolation</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>Egress Control:</strong> Workers can only reach SCM and AI providers</li>
                  <li><strong>No Production Access:</strong> Workers cannot access your production systems</li>
                  <li><strong>Internal Network:</strong> Workers run in isolated VPC subnets</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Credential Handling</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li><strong>Injected at Runtime:</strong> Secrets provided via environment variables</li>
                  <li><strong>Never Logged:</strong> Credentials automatically redacted from logs</li>
                  <li><strong>Scoped Access:</strong> Workers only receive required credentials</li>
                </ul>
              </section>

              {/* Section 5: Audit & Compliance */}
              <section id="audit" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <Eye className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Audit & Compliance</h2>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">Audit Logging</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>Authentication Events:</strong> Login attempts, password changes, MFA</li>
                  <li><strong>Authorization Events:</strong> Role changes, API key creation/revocation</li>
                  <li><strong>Data Access:</strong> Significant data reads and modifications</li>
                  <li><strong>Settings Changes:</strong> Organization and integration configuration</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Retention Policies</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li><strong>Configurable:</strong> Set log retention from 30 to unlimited days</li>
                  <li><strong>Audit Logs:</strong> Retained permanently for compliance</li>
                  <li><strong>Export Available:</strong> Download your audit logs anytime</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Compliance</h3>
                <p className="text-muted-foreground leading-relaxed">
                  WorkerMill leverages AWS's compliance certifications and implements controls aligned with:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                  <li>SOC 2 Type II (via AWS infrastructure)</li>
                  <li>GDPR data protection requirements</li>
                  <li>CCPA privacy requirements</li>
                </ul>
              </section>

              {/* Section 6: Incident Response */}
              <section id="incident-response" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <AlertTriangle className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Incident Response</h2>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">Detection & Monitoring</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-6">
                  <li>24/7 automated monitoring for security anomalies</li>
                  <li>Real-time alerting for suspicious activities</li>
                  <li>Regular security assessments and penetration testing</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Incident Notification</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  In the event of a security incident that affects your data, we will:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Notify affected customers within 72 hours</li>
                  <li>Provide details about the scope and impact</li>
                  <li>Describe remediation steps taken</li>
                  <li>Offer guidance on protective measures</li>
                </ul>
              </section>

              {/* Section 7: Responsible Disclosure */}
              <section id="disclosure" className="scroll-mt-24">
                <div className="flex items-center gap-3 mb-4">
                  <Mail className="w-6 h-6 text-primary" />
                  <h2 className="text-2xl font-bold text-foreground m-0">Responsible Disclosure</h2>
                </div>

                <p className="text-muted-foreground leading-relaxed mb-4">
                  We appreciate security researchers who help us keep WorkerMill secure. If you discover
                  a security vulnerability, please report it responsibly:
                </p>

                <div className="bg-card border border-border rounded-lg p-6 mb-6">
                  <p className="text-foreground font-medium mb-2">Security Reports</p>
                  <p className="text-muted-foreground">
                    Email: security@workermill.com
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Please include detailed reproduction steps and potential impact assessment.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">Our Commitment</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Acknowledge receipt within 48 hours</li>
                  <li>Provide regular updates on remediation progress</li>
                  <li>Credit researchers who report valid vulnerabilities (if desired)</li>
                  <li>Not pursue legal action against good-faith security research</li>
                </ul>
              </section>
            </div>

            {/* Related Links */}
            <div className="mt-16 pt-8 border-t border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Related Documents</h3>
              <div className="flex flex-wrap gap-4">
                <Link
                  to="/terms"
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Terms of Service
                </Link>
                <Link
                  to="/privacy"
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Privacy Policy
                </Link>
              </div>
            </div>

            {/* Contact Card */}
            <div className="mt-8 bg-primary/5 border border-primary/20 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">Security Questions?</h3>
              <p className="text-muted-foreground mb-4">
                If you have questions about our security practices or need additional information for
                your security review, please contact our team.
              </p>
              <a
                href="mailto:security@workermill.com"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Mail className="w-4 h-4" />
                Contact Security Team
              </a>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export { SECURITY_VERSION };
