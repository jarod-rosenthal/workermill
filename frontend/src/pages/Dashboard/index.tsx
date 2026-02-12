import { RoleSwitcher, useRoleState } from '../../components/dashboards/RoleSwitcher';
import { EngineerView } from './EngineerView';
import { ManagerView } from './ManagerView';
import { DevOpsView } from './DevOpsView';
import { SecurityView } from './SecurityView';
import { QAView } from './QAView';
import { TechLeadView } from './TechLeadView';
import { ProductManagerView } from './ProductManagerView';
import { HRView } from './HRView';
import { CTOView } from './CTOView';
import { FinanceView } from './FinanceView';
import { SalesView } from './SalesView';
import { MarketingView } from './MarketingView';
import type { UserRole } from '../../types/dashboard';

interface RoleBasedDashboardProps {
  defaultRole?: UserRole;
}

/**
 * RoleBasedDashboard - Main entry point for role-based dashboard views
 *
 * This component provides a role switcher and renders the appropriate
 * dashboard view based on the selected role.
 *
 * Available roles:
 * - engineer: Task execution and PR management
 * - manager: Team performance and cost tracking
 * - devops: Deployments and system health
 * - security: Audits and compliance
 * - qa: Testing and quality metrics
 * - tech_lead: Architecture and code review
 * - product_manager: Sprint progress and tickets
 * - hr: Team utilization and adoption
 * - cto: Executive ROI and strategic metrics
 * - finance: Budget tracking and cost management
 * - sales: Demo mode and customer success metrics
 * - marketing: Release timeline and announcements
 */
export function RoleBasedDashboard({ defaultRole = 'engineer' }: RoleBasedDashboardProps) {
  const { currentRole, setCurrentRole } = useRoleState(defaultRole);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Fixed Role Switcher Header */}
      <div className="sticky top-0 z-40 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Dashboard
          </h2>
          <RoleSwitcher
            currentRole={currentRole}
            onRoleChange={setCurrentRole}
            compact
          />
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <DashboardView role={currentRole} />
      </div>
    </div>
  );
}

interface DashboardViewProps {
  role: UserRole;
}

function DashboardView({ role }: DashboardViewProps) {
  switch (role) {
    case 'engineer':
      return <EngineerView />;
    case 'manager':
      return <ManagerView />;
    case 'devops':
      return <DevOpsView />;
    case 'security':
      return <SecurityView />;
    case 'qa':
      return <QAView />;
    case 'tech_lead':
      return <TechLeadView />;
    case 'product_manager':
      return <ProductManagerView />;
    case 'hr':
      return <HRView />;
    case 'cto':
      return <CTOView />;
    case 'finance':
      return <FinanceView />;
    case 'sales':
      return <SalesView />;
    case 'marketing':
      return <MarketingView />;
    default:
      return <EngineerView />;
  }
}

// Export individual views for direct access
export { EngineerView } from './EngineerView';
export { ManagerView } from './ManagerView';
export { DevOpsView } from './DevOpsView';
export { SecurityView } from './SecurityView';
export { QAView } from './QAView';
export { TechLeadView } from './TechLeadView';
export { ProductManagerView } from './ProductManagerView';
export { HRView } from './HRView';
export { CTOView } from './CTOView';
export { FinanceView } from './FinanceView';
export { SalesView } from './SalesView';
export { MarketingView } from './MarketingView';

// Re-export the main Dashboard component as the default export
// This allows `import Dashboard from "./pages/Dashboard"` to resolve correctly
// after the monolithic Dashboard.tsx was decomposed into this directory.
export { default } from "./MainDashboard";
