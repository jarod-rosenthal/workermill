import { Link } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { ThemeToggle } from "../../components/ThemeToggle";

const TOS_VERSION = "2026-01-28";

interface Section {
  id: string;
  title: string;
}

const sections: Section[] = [
  { id: "acceptance", title: "1. Acceptance of Terms" },
  { id: "service-description", title: "2. Service Description" },
  { id: "accounts", title: "3. Account & Registration" },
  { id: "billing", title: "4. Billing & Payment" },
  { id: "acceptable-use", title: "5. Acceptable Use Policy" },
  { id: "intellectual-property", title: "6. Intellectual Property" },
  { id: "third-party", title: "7. Third-Party Services" },
  { id: "data-privacy", title: "8. Data & Privacy" },
  { id: "availability", title: "9. Service Availability" },
  { id: "liability", title: "10. Limitation of Liability" },
  { id: "indemnification", title: "11. Indemnification" },
  { id: "disputes", title: "12. Dispute Resolution" },
  { id: "termination", title: "13. Termination" },
  { id: "modifications", title: "14. Modifications" },
  { id: "contact", title: "15. Contact Information" },
];

export default function Terms() {
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
              <FileText className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-foreground">Terms of Service</h2>
            </div>
            <nav className="space-y-1">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
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
              <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Service</h1>
              <p className="text-sm text-muted-foreground">
                Last updated: {TOS_VERSION}
              </p>
            </div>

            <div className="prose prose-slate dark:prose-invert max-w-none space-y-12">
              {/* Section 1: Acceptance */}
              <section id="acceptance" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">1. Acceptance of Terms</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  By accessing or using WorkerMill ("Service"), you agree to be bound by these Terms of Service ("Terms").
                  If you are using the Service on behalf of an organization, you represent that you have the authority to
                  bind that organization to these Terms.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You must be at least 18 years of age to use this Service. By using the Service, you represent and
                  warrant that you meet this age requirement.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  If you do not agree to these Terms, you may not access or use the Service.
                </p>
              </section>

              {/* Section 2: Service Description */}
              <section id="service-description" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">2. Service Description</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  WorkerMill is an AI-powered code generation and task automation platform. The Service:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Executes AI workers that generate code based on your issue tickets (Jira, Linear)</li>
                  <li>Creates pull requests in your source code repositories (GitHub, GitLab, BitBucket)</li>
                  <li>Integrates with third-party AI providers to process your requests</li>
                  <li>Provides monitoring, analytics, and orchestration capabilities</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed">
                  The Service operates on a "Bring Your Own Keys" (BYOK) model where you provide your own API keys
                  for AI providers. WorkerMill orchestrates the execution but does not guarantee the quality,
                  correctness, or security of AI-generated code.
                </p>
              </section>

              {/* Section 3: Accounts */}
              <section id="accounts" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">3. Account & Registration</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  To use the Service, you must create an account and provide accurate, complete information.
                  You are responsible for:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Maintaining the confidentiality of your account credentials</li>
                  <li>All activities that occur under your account</li>
                  <li>Notifying us immediately of any unauthorized use</li>
                  <li>Ensuring your API keys and integration tokens remain secure</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed">
                  You may use OAuth to connect your GitHub, Jira, or other service accounts. You are responsible
                  for maintaining the security of your account credentials and all connected accounts.
                </p>
              </section>

              {/* Section 4: Billing */}
              <section id="billing" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">4. Billing & Payment</h2>

                <h3 className="text-lg font-semibold text-foreground mb-2">Service Tiers</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Service tiers and pricing, if applicable, are described on the WorkerMill website and may change from time to time. Self-hosted deployments are free and open source — you are responsible only for the costs of your own infrastructure and API keys.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Payment Processing</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Payments are processed through Stripe, a PCI-compliant payment processor. By providing payment
                  information, you authorize us to charge your payment method for subscription fees.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Subscription Terms</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  All subscriptions are <strong>month-to-month</strong>. You may cancel at any time. Upon cancellation:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>You will receive a prorated refund for unused time in the current billing period</li>
                  <li>Your access continues until the end of the paid period</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Price Changes</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We will provide at least 30 days' notice before implementing any price changes. Continued use
                  of the Service after price changes take effect constitutes acceptance of the new pricing.
                </p>
              </section>

              {/* Section 5: Acceptable Use */}
              <section id="acceptable-use" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">5. Acceptable Use Policy</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You agree not to use the Service to:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Generate malicious code, malware, or code intended to harm systems or users</li>
                  <li>Circumvent security measures of the Service or any connected systems</li>
                  <li>Consume excessive resources in a manner that degrades service for other users</li>
                  <li>Engage in any illegal activities or generate code for illegal purposes</li>
                  <li>Violate any third-party rights, including intellectual property rights</li>
                  <li>Generate code that infringes on copyrights, patents, or other protected works</li>
                  <li>Attempt to reverse engineer, decompile, or extract source code from the Service</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed">
                  You are solely responsible for ensuring that any code generated through the Service complies
                  with all applicable licenses, laws, and regulations.
                </p>
              </section>

              {/* Section 6: Intellectual Property */}
              <section id="intellectual-property" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">6. Intellectual Property</h2>

                <h3 className="text-lg font-semibold text-foreground mb-2">Your Code</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You retain all ownership rights to your source code, repositories, and any code generated
                  through the Service on your behalf. WorkerMill claims no ownership over code produced by AI workers.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">AI-Generated Code</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Code generated by AI workers is provided to you without warranty of originality. AI models may
                  produce code similar to existing works. You are responsible for:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Reviewing all AI-generated code before use</li>
                  <li>Ensuring compliance with applicable licenses</li>
                  <li>Any claims arising from use of AI-generated code</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">WorkerMill Platform</h3>
                <p className="text-muted-foreground leading-relaxed">
                  WorkerMill retains all rights to the Service, including the platform, APIs, documentation,
                  trademarks, and any proprietary technology. You may not copy, modify, or create derivative
                  works of the Service without express written permission.
                </p>
              </section>

              {/* Section 7: Third-Party Services */}
              <section id="third-party" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">7. Third-Party Services</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  The Service integrates with various third-party services. Your use of these integrations is
                  subject to the respective third-party terms of service:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li><strong>AI Providers:</strong> Anthropic, OpenAI, Google, Ollama</li>
                  <li><strong>Source Control:</strong> GitHub, GitLab, BitBucket</li>
                  <li><strong>Issue Tracking:</strong> Jira, Linear</li>
                  <li><strong>Communication:</strong> Slack</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  When using BYOK (Bring Your Own Keys), you are responsible for:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Compliance with the AI provider's terms of service</li>
                  <li>Any costs incurred with the AI provider</li>
                  <li>The security and management of your API keys</li>
                </ul>
              </section>

              {/* Section 8: Data & Privacy */}
              <section id="data-privacy" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">8. Data & Privacy</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Your use of the Service is also governed by our{" "}
                  <Link to="/privacy" className="text-primary hover:underline">
                    Privacy Policy
                  </Link>
                  , which describes how we collect, use, and protect your information.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  By using the Service, you acknowledge that:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Your code and task descriptions are sent to AI providers for processing</li>
                  <li>Task logs and execution history are retained according to your plan settings</li>
                  <li>You can configure log retention periods in your organization settings</li>
                  <li>Audit logs may be retained for security and compliance purposes</li>
                </ul>
              </section>

              {/* Section 9: Service Availability */}
              <section id="availability" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">9. Service Availability</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  WorkerMill strives to maintain high availability but does not guarantee uninterrupted service.
                  Standard plans do not include a Service Level Agreement (SLA).
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Worker execution may occasionally be interrupted due to infrastructure scaling. When
                  interruptions occur, tasks are automatically re-queued for retry up to the configured maximum.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may perform scheduled maintenance with reasonable advance notice when possible. In case of
                  emergency maintenance, we will provide notice as soon as practicable.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  WorkerMill is not liable for service interruptions caused by force majeure events, including
                  but not limited to natural disasters, acts of government, or infrastructure failures beyond
                  our reasonable control.
                </p>
              </section>

              {/* Section 10: Limitation of Liability */}
              <section id="liability" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">10. Limitation of Liability</h2>
                <p className="text-muted-foreground leading-relaxed mb-4 font-semibold">
                  IMPORTANT: AI-GENERATED CODE MAY CONTAIN BUGS, SECURITY VULNERABILITIES, OR OTHER DEFECTS.
                  YOU ARE SOLELY RESPONSIBLE FOR REVIEWING AND TESTING ALL CODE BEFORE DEPLOYMENT.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>
                    THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED
                  </li>
                  <li>
                    WORKERMILL'S TOTAL LIABILITY SHALL NOT EXCEED THE FEES PAID BY YOU IN THE 12 MONTHS
                    PRECEDING THE CLAIM
                  </li>
                  <li>
                    WORKERMILL SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
                    OR PUNITIVE DAMAGES
                  </li>
                  <li>
                    WORKERMILL IS NOT LIABLE FOR DAMAGES ARISING FROM CODE GENERATED BY AI WORKERS
                  </li>
                </ul>
                <p className="text-muted-foreground leading-relaxed">
                  Some jurisdictions do not allow the exclusion of certain warranties or limitations of liability,
                  so some of the above limitations may not apply to you.
                </p>
              </section>

              {/* Section 11: Indemnification */}
              <section id="indemnification" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">11. Indemnification</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You agree to indemnify, defend, and hold harmless WorkerMill, its officers, directors,
                  employees, and agents from any claims, damages, losses, or expenses (including reasonable
                  attorney's fees) arising from:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2">
                  <li>Your use of the Service</li>
                  <li>Your violation of these Terms</li>
                  <li>Your violation of any third-party rights</li>
                  <li>Code generated through the Service at your direction</li>
                  <li>Any intellectual property claims related to AI-generated code</li>
                </ul>
              </section>

              {/* Section 12: Dispute Resolution */}
              <section id="disputes" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">12. Dispute Resolution</h2>

                <h3 className="text-lg font-semibold text-foreground mb-2">Governing Law</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  These Terms shall be governed by and construed in accordance with the laws of the State of
                  Delaware, United States, without regard to its conflict of law provisions.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Mandatory Binding Arbitration</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Any dispute arising out of or relating to these Terms or the Service shall be resolved by
                  binding arbitration administered by the American Arbitration Association (AAA) under its
                  Commercial Arbitration Rules.
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Arbitration shall take place in Wilmington, Delaware</li>
                  <li>The arbitrator's decision shall be final and binding</li>
                  <li>Judgment may be entered in any court of competent jurisdiction</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Class Action Waiver</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  YOU AGREE TO RESOLVE DISPUTES ONLY ON AN INDIVIDUAL BASIS AND WAIVE ANY RIGHT TO PARTICIPATE
                  IN CLASS ACTION LAWSUITS OR CLASS-WIDE ARBITRATION.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Small Claims Exception</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Notwithstanding the above, either party may bring individual claims in small claims court if
                  the claims qualify.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">Limitation Period</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Any claim relating to these Terms or the Service must be brought within one (1) year after
                  the cause of action arises.
                </p>
              </section>

              {/* Section 13: Termination */}
              <section id="termination" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">13. Termination</h2>

                <h3 className="text-lg font-semibold text-foreground mb-2">By You</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  You may cancel your subscription at any time through your account settings or by contacting
                  support. Upon cancellation, you will receive a prorated refund for unused time.
                </p>

                <h3 className="text-lg font-semibold text-foreground mb-2">By WorkerMill</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may suspend or terminate your access to the Service immediately if you:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
                  <li>Violate these Terms or the Acceptable Use Policy</li>
                  <li>Fail to pay applicable fees</li>
                  <li>Engage in fraudulent or illegal activity</li>
                  <li>Pose a security risk to the Service or other users</li>
                </ul>

                <h3 className="text-lg font-semibold text-foreground mb-2">Effect of Termination</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Upon termination, your right to access the Service ends immediately. Your data will be
                  deleted according to our retention policies unless legal requirements mandate otherwise.
                  Sections 5-12 of these Terms survive termination.
                </p>
              </section>

              {/* Section 14: Modifications */}
              <section id="modifications" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">14. Modifications</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We may modify these Terms at any time. For material changes, we will provide at least 30 days'
                  notice via email or through the Service.
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Your continued use of the Service after the effective date of any modifications constitutes
                  acceptance of the updated Terms. If you do not agree to the modified Terms, you must stop
                  using the Service.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  We encourage you to review these Terms periodically. The "Last updated" date at the top of
                  this page indicates when these Terms were last revised.
                </p>
              </section>

              {/* Section 15: Contact */}
              <section id="contact" className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-foreground mb-4">15. Contact Information</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  If you have any questions about these Terms, please contact us:
                </p>
                <div className="bg-card border border-border rounded-lg p-6">
                  <p className="text-foreground font-medium mb-2">WorkerMill Legal</p>
                  <p className="text-muted-foreground">
                    Email: legal@workermill.com
                  </p>
                </div>
              </section>
            </div>

            {/* Related Links */}
            <div className="mt-16 pt-8 border-t border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Related Documents</h3>
              <div className="flex flex-wrap gap-4">
                <Link
                  to="/privacy"
                  className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Privacy Policy
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

export { TOS_VERSION };
