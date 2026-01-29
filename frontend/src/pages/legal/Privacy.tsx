import { Link } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import { ThemeToggle } from "../../components/ThemeToggle";

const PRIVACY_VERSION = "2026-01-28";

interface Section {
  id: string;
  title: string;
}

const sections: Section[] = [
  { id: "information-collected", title: "1. Information We Collect" },
  { id: "how-we-use", title: "2. How We Use Information" },
  { id: "information-sharing", title: "3. Information Sharing" },
  { id: "data-retention", title: "4. Data Retention" },
  { id: "your-rights", title: "5. Your Rights" },
  { id: "security", title: "6. Security" },
  { id: "international", title: "7. International Transfers" },
  { id: "children", title: "8. Children's Privacy" },
  { id: "ccpa", title: "9. California Privacy Rights" },
  { id: "contact", title: "10. Contact & DPO" },
];

interface Subprocessor {
  service: string;
  purpose: string;
  dataShared: string;
}

const subprocessors: Subprocessor[] = [
  {
    service: "AWS (Cognito)",
    purpose: "Authentication",
    dataShared: "Email, name",
  },
  {
    service: "AWS (ECS/RDS)",
    purpose: "Infrastructure",
    dataShared: "All application data",
  },
  {
    service: "AWS (SES)",
    purpose: "Email",
    dataShared: "Email addresses, notifications",
  },
  {
    service: "Stripe",
    purpose: "Payments",
    dataShared: "Email, org name, payment data",
  },
  {
    service: "Anthropic",
    purpose: "AI processing",
    dataShared: "Code context, task descriptions",
  },
  {
    service: "OpenAI",
    purpose: "AI processing",
    dataShared: "Code context, task descriptions",
  },
  {
    service: "Google",
    purpose: "AI processing",
    dataShared: "Code context, task descriptions",
  },
  {
    service: "GitHub/GitLab/Bitbucket",
    purpose: "Source control",
    dataShared: "Repository access, PRs",
  },
  {
    service: "Jira/Linear",
    purpose: "Issue tracking",
    dataShared: "Issue data, status updates",
  },
];

export default function Privacy() {
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
              <h2 className="font-semibold text-foreground">Privacy Policy</h2>
            </div>
            <nav className="space-y-1">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`***REMOVED***${section.id}`}
                  className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
                >
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
              <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
              <p className="text-sm text-muted-foreground">
                Last updated: {PRIVACY_VERSION}
              </p>
            </div>

            <div className="prose prose-slate dark:prose-invert max-w-none space-y-12">
              {/* Introduction */}
              <p className="text-muted-foreground leading-relaxed">
                WorkerMill ("we", "us", or "our") respects your privacy and is committed to protecting your
                personal data. This Privacy Policy explains how we collect, use, disclose, and safeguard your
                information when you use our Service.
              </p>

              {/* Section 1: Information Collected */}
              <section id="information-collected" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">1. Information We Collect</h2>

                <h3 className="text-lg font-semibold text-foreground mb-2">Account Data</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Email address</li>
                  <li>Full name</li>
                  <li>Organization name</li>
                  <li>Profile information from OAuth providers (if connected)</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Usage Data</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Task logs and execution history</li>
                  <li>API activity and request logs</li>
                  <li>Feature usage analytics</li>
                  <li>Integration connection status</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Financial Data</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Stripe customer ID</li>
                  <li>Subscription status and plan details</li>
                  <li>Transaction history</li>
                  <li>Note: We do not store credit card numbers - these are handled directly by Stripe</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Technical Data</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>IP address</li>
                  <li>Browser type and user agent</li>
                  <li>Audit logs (login events, settings changes)</li>
                  <li>Device information</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Code Data</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Repository content accessed during task execution</li>
                  <li>Task descriptions and acceptance criteria from issue trackers</li>
                  <li>Code context sent to AI providers for processing</li>
                  <li>Pull request content and comments</li>
                </ul>
              </section>

              {/* Section 2: How We Use Information */}
              <section id="how-we-use" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">2. How We Use Information</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We use the information we collect to:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li><strong>Provide the Service:</strong> Execute AI workers, manage tasks, create pull requests</li>
                  <li><strong>Process payments:</strong> Handle subscriptions, billing, and invoicing via Stripe</li>
                  <li><strong>Send notifications:</strong> Task completion alerts, billing notifications, security alerts (configurable)</li>
                  <li><strong>Improve the Service:</strong> Analyze usage patterns to enhance features and performance</li>
                  <li><strong>Security:</strong> Detect and prevent fraud, abuse, and unauthorized access</li>
                  <li><strong>Legal compliance:</strong> Fulfill our legal obligations and respond to lawful requests</li>
                  <li><strong>Support:</strong> Respond to your inquiries and provide customer assistance</li>
                </ul>
              </section>

              {/* Section 3: Information Sharing */}
              <section id="information-sharing" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">3. Information Sharing</h2>

                <h3 className="text-lg font-semibold text-foreground mb-4">Subprocessors</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We share data with the following third-party service providers to operate the Service:
                </p>

                <div className="overflow-x-auto mb-6">
                  <table className="w-full border border-border rounded-lg overflow-hidden">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Service</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Purpose</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Data Shared</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {subprocessors.map((sp, index) => (
                        <tr key={index} className={index % 2 === 0 ? "bg-card" : "bg-muted/30"}>
                          <td className="px-4 py-3 text-sm text-foreground">{sp.service}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{sp.purpose}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{sp.dataShared}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">We Do Not Sell Personal Data</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  WorkerMill does not sell, rent, or trade your personal information to third parties for
                  their marketing purposes.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Law Enforcement</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We may disclose your information if required by law, court order, or government request,
                  or if we believe disclosure is necessary to protect our rights, your safety, or the safety
                  of others.
                </p>
              </section>

              {/* Section 4: Data Retention */}
              <section id="data-retention" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">4. Data Retention</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We retain different types of data for different periods:
                </p>

                <div className="overflow-x-auto mb-4">
                  <table className="w-full border border-border rounded-lg overflow-hidden">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Data Type</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Retention Period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr className="bg-card">
                        <td className="px-4 py-3 text-sm text-foreground">Task logs</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">30 days default (configurable to 90+ days)</td>
                      </tr>
                      <tr className="bg-muted/30">
                        <td className="px-4 py-3 text-sm text-foreground">Task records</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">90 days default (configurable)</td>
                      </tr>
                      <tr className="bg-card">
                        <td className="px-4 py-3 text-sm text-foreground">Audit logs</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">Permanent (security/compliance)</td>
                      </tr>
                      <tr className="bg-muted/30">
                        <td className="px-4 py-3 text-sm text-foreground">Account data</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">Until account deletion requested</td>
                      </tr>
                      <tr className="bg-card">
                        <td className="px-4 py-3 text-sm text-foreground">Billing records</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">7 years (legal requirement)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  You can configure log and task retention periods in your organization settings. Some data
                  may be retained longer for legal compliance or legitimate business purposes.
                </p>
              </section>

              {/* Section 5: Your Rights */}
              <section id="your-rights" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">5. Your Rights</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You have the following rights regarding your personal data:
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Access</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can access your data through the dashboard or via the API. Task history, logs, and
                  account information are available in your account settings.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Deletion</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can request account deletion, which will cascade delete all associated data including
                  tasks, logs, and organization data. Contact support@workermill.com to request deletion.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Export</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You can export your task history and logs through the dashboard or API at any time.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Opt-Out</h3>
                <p className="text-muted-foreground leading-relaxed">
                  You can opt out of marketing emails through your notification settings. Transactional
                  emails (billing, security alerts) cannot be disabled while your account is active.
                </p>
              </section>

              {/* Section 6: Security */}
              <section id="security" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">6. Security</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We implement appropriate technical and organizational measures to protect your personal data.
                  For detailed information about our security practices, please see our{" "}
                  <Link to="/security" className="text-primary hover:underline">
                    Security page
                  </Link>.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Key security measures include:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                  <li>TLS encryption for all data in transit</li>
                  <li>Encryption at rest for database storage</li>
                  <li>AWS Secrets Manager for credential storage</li>
                  <li>Multi-tenant isolation with organization-level access controls</li>
                  <li>Regular security assessments</li>
                </ul>
              </section>

              {/* Section 7: International Transfers */}
              <section id="international" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">7. International Transfers</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  WorkerMill processes data in the United States (AWS us-east-1 region). If you are located
                  outside the United States, your data will be transferred to and processed in the US.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  For users in the European Economic Area (EEA), we rely on:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Standard Contractual Clauses (SCCs) approved by the European Commission</li>
                  <li>Subprocessor compliance with equivalent data protection standards</li>
                </ul>
              </section>

              {/* Section 8: Children */}
              <section id="children" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">8. Children's Privacy</h2>
                <p className="text-muted-foreground leading-relaxed">
                  WorkerMill is not intended for use by individuals under 18 years of age. We do not knowingly
                  collect personal information from children. If we become aware that a child has provided us
                  with personal information, we will take steps to delete such information promptly.
                </p>
              </section>

              {/* Section 9: CCPA */}
              <section id="ccpa" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">9. California Privacy Rights (CCPA)</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you are a California resident, you have additional rights under the California Consumer
                  Privacy Act (CCPA):
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Right to Know</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You have the right to know what personal information we collect, use, disclose, and sell
                  about you. This Privacy Policy provides this information.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Right to Delete</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You have the right to request deletion of your personal information, subject to certain
                  exceptions (e.g., legal obligations, security, completing transactions).
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">No Sale of Personal Information</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  WorkerMill does not sell personal information as defined under the CCPA.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Non-Discrimination</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We will not discriminate against you for exercising your CCPA rights.
                </p>
              </section>

              {/* Section 10: Contact */}
              <section id="contact" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">10. Contact & DPO</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you have questions about this Privacy Policy or want to exercise your privacy rights,
                  please contact us:
                </p>
                <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                  <div>
                    <p className="text-foreground font-medium mb-1">Privacy Inquiries</p>
                    <p className="text-muted-foreground">
                      Email: privacy@workermill.com
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium mb-1">General Support</p>
                    <p className="text-muted-foreground">
                      Email: support@workermill.com
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground leading-relaxed mt-4">
                  We will respond to your request within 30 days, or as required by applicable law.
                </p>
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
                  to="/security"
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Security
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export { PRIVACY_VERSION };
