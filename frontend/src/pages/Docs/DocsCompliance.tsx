import {
  Shield,
  FileText,
  Clock,
  Lock,
  Users,
  Activity,
  CheckCircle,
  Key,
  Database,
  Eye,
  Download,
  Settings,
  Server,
  Globe,
} from "lucide-react";

// Audit action categories from api/src/services/audit.ts
const auditCategories = [
  {
    category: "Authentication",
    icon: Key,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    actions: ["login", "logout", "password_change", "mfa_enable", "mfa_disable"],
    description: "User authentication events including login attempts, session management, and MFA changes.",
  },
  {
    category: "Task Operations",
    icon: Activity,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    actions: ["task_create", "task_cancel", "task_retry", "task_complete"],
    description: "Worker task lifecycle events from creation through completion or cancellation.",
  },
  {
    category: "API Key Management",
    icon: Lock,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    actions: ["api_key_create", "api_key_revoke", "api_key_rotate"],
    description: "API key operations including creation, revocation, and rotation events.",
  },
  {
    category: "User Management",
    icon: Users,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    actions: ["user_invite", "user_remove", "role_change"],
    description: "User account management including invitations, removals, and role changes.",
  },
  {
    category: "Settings Changes",
    icon: Settings,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    actions: ["settings_update", "integration_connect", "integration_disconnect"],
    description: "Organization settings and integration configuration changes.",
  },
  {
    category: "Data Access",
    icon: Eye,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    actions: ["export_data", "view_sensitive", "download_logs"],
    description: "Sensitive data access events including exports and log downloads.",
  },
  {
    category: "Billing",
    icon: FileText,
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    actions: ["payment_method_add", "subscription_change", "invoice_download"],
    description: "Billing-related events including payment methods and subscription changes.",
  },
  {
    category: "Security Events",
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    actions: ["failed_login", "suspicious_activity", "ip_block"],
    description: "Security-related events including failed logins and suspicious activity detection.",
  },
];

// Compliance frameworks
const complianceFrameworks = [
  {
    name: "SOC 2 Type II",
    status: "Planned",
    statusColor: "text-amber-500",
    description: "Service Organization Control 2 compliance for security, availability, and confidentiality.",
    controls: ["Access Controls", "Data Encryption", "Audit Logging", "Incident Response"],
  },
  {
    name: "GDPR",
    status: "By Design",
    statusColor: "text-green-500",
    description: "General Data Protection Regulation compliance for EU data subjects.",
    controls: ["Data Minimization", "Right to Erasure", "Data Portability", "Consent Management"],
  },
  {
    name: "HIPAA",
    status: "Planned",
    statusColor: "text-amber-500",
    description: "Health Insurance Portability and Accountability Act compliance (Enterprise plan).",
    controls: ["PHI Protection", "Access Audit", "Encryption at Rest", "BAA Available"],
  },
];

// Data retention policies
const retentionPolicies = [
  { data: "Task Logs", retention: "14-90 days (plan-dependent)", configurable: true },
  { data: "Completed Tasks", retention: "90 days", configurable: true },
  { data: "Audit Logs", retention: "1 year", configurable: false },
  { data: "User Sessions", retention: "24 hours", configurable: false },
  { data: "API Key History", retention: "Permanent", configurable: false },
];

export default function DocsCompliance() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Compliance & Security</h1>
        <p className="text-muted-foreground">
          WorkerMill is designed with enterprise security and compliance requirements in mind.
          Comprehensive audit logging, data protection, and compliance framework support.
        </p>
      </div>

      {/* Compliance Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          Compliance Frameworks
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {complianceFrameworks.map((framework) => (
            <div key={framework.name} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground">{framework.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full bg-muted ${framework.statusColor}`}>
                  {framework.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{framework.description}</p>
              <div className="flex flex-wrap gap-1">
                {framework.controls.map((control) => (
                  <span key={control} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {control}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Audit Logging */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-green-500" />
          Audit Logging
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <p className="text-muted-foreground">
            WorkerMill captures comprehensive audit logs for all security-relevant actions.
            Logs are immutable, tamper-evident, and retained for compliance purposes.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {auditCategories.map((cat) => (
              <div key={cat.category} className="bg-background rounded-lg p-4 border border-border">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-1.5 rounded ${cat.bgColor}`}>
                    <cat.icon className={`w-4 h-4 ${cat.color}`} />
                  </div>
                  <h4 className="font-medium text-foreground text-sm">{cat.category}</h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{cat.description}</p>
                <div className="flex flex-wrap gap-1">
                  {cat.actions.slice(0, 3).map((action) => (
                    <span key={action} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {action}
                    </span>
                  ))}
                  {cat.actions.length > 3 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      +{cat.actions.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Audit Log Details */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Audit Log Contents</h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Each audit log entry contains detailed context for investigation and compliance:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground text-sm mb-2">Event Details</h4>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>Timestamp (UTC, millisecond precision)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>Action type and category</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>Actor (user ID, email, role)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>Resource affected (ID, type)</span>
                </li>
              </ul>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground text-sm mb-2">Context</h4>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>IP address and geolocation</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>User agent / device info</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>Before/after state for changes</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-green-500" />
                  <span>Request ID for correlation</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Data Retention */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          Data Retention Policies
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-foreground font-medium">Data Type</th>
                <th className="text-left px-4 py-3 text-foreground font-medium">Retention Period</th>
                <th className="text-left px-4 py-3 text-foreground font-medium">Configurable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {retentionPolicies.map((policy) => (
                <tr key={policy.data}>
                  <td className="px-4 py-3 text-foreground">{policy.data}</td>
                  <td className="px-4 py-3 text-muted-foreground">{policy.retention}</td>
                  <td className="px-4 py-3">
                    {policy.configurable ? (
                      <span className="text-green-500 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Yes
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Fixed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure retention policies in <span className="text-foreground font-medium">Settings → Compliance → Retention</span>.
          Log retention: 14 days (Free), 90 days (Pro), unlimited (Enterprise).
        </p>
      </section>

      {/* Security Features */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Lock className="w-5 h-5 text-red-500" />
          Security Features
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Key className="w-4 h-4 text-blue-500" />
              Access Controls
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Role-based access control (RBAC) with admin, member, and viewer roles</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>SSO integration with SAML and OIDC (Enterprise)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Multi-factor authentication (MFA) support</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Session management with configurable timeouts</span>
              </li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-purple-500" />
              Data Protection
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Encryption at rest (AES-256) for all stored data</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Encryption in transit (TLS 1.3) for all connections</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>API key hashing with bcrypt</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Secrets never logged or stored in plain text</span>
              </li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Server className="w-4 h-4 text-orange-500" />
              Infrastructure Security
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Isolated VPC with private subnets</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>WAF protection against common attacks</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>DDoS protection via AWS Shield</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Regular security patching and updates</span>
              </li>
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-500" />
              API Security
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Rate limiting per API key and IP</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>API key rotation support</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Scoped API keys with limited permissions</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-green-500 mt-1 flex-shrink-0" />
                <span>Webhook signature verification</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Compliance Reports */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Download className="w-5 h-5 text-indigo-500" />
          Compliance Reports
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Generate compliance reports for audits and internal reviews. Available in the Compliance Center.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground text-sm mb-2">Audit Log Export</h4>
              <p className="text-xs text-muted-foreground">
                Export audit logs in CSV or JSON format for external analysis.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground text-sm mb-2">Access Review Report</h4>
              <p className="text-xs text-muted-foreground">
                User access summary including roles, permissions, and last activity.
              </p>
            </div>
            <div className="bg-background rounded-lg p-4 border border-border">
              <h4 className="font-medium text-foreground text-sm mb-2">Security Posture Report</h4>
              <p className="text-xs text-muted-foreground">
                Overview of security settings, enabled features, and recommendations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise Features */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Enterprise Compliance Features</h2>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            Additional compliance features available on Enterprise plans:
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-primary mt-1 flex-shrink-0" />
                <span>HIPAA BAA (Business Associate Agreement)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-primary mt-1 flex-shrink-0" />
                <span>Custom data retention policies</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-primary mt-1 flex-shrink-0" />
                <span>Dedicated compliance support</span>
              </li>
            </ul>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-primary mt-1 flex-shrink-0" />
                <span>Custom audit log integrations (SIEM)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-primary mt-1 flex-shrink-0" />
                <span>Penetration testing reports</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3 h-3 text-primary mt-1 flex-shrink-0" />
                <span>SOC 2 Type II attestation report</span>
              </li>
            </ul>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            Contact <span className="text-foreground font-medium">sales@workermill.com</span> for Enterprise compliance requirements.
          </p>
        </div>
      </section>
    </div>
  );
}
