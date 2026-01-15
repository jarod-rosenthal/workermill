import { useState, useRef, useEffect } from 'react';
import {
  Code,
  Users,
  Server,
  Shield,
  TestTube,
  Compass,
  FileText,
  Heart,
  ChevronDown,
  Check,
  Building2,
  Wallet,
} from 'lucide-react';
import type { UserRole, RoleConfig } from '../../types/dashboard';

const roleConfigs: RoleConfig[] = [
  {
    id: 'engineer',
    label: 'Engineer',
    description: 'Task execution and PR management',
    icon: 'code',
  },
  {
    id: 'manager',
    label: 'Manager',
    description: 'Team performance and cost tracking',
    icon: 'users',
  },
  {
    id: 'devops',
    label: 'DevOps',
    description: 'Deployments and system health',
    icon: 'server',
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Audits and compliance',
    icon: 'shield',
  },
  {
    id: 'qa',
    label: 'QA',
    description: 'Testing and quality metrics',
    icon: 'test-tube',
  },
  {
    id: 'tech_lead',
    label: 'Tech Lead',
    description: 'Architecture and code review',
    icon: 'compass',
  },
  {
    id: 'product_manager',
    label: 'Product Manager',
    description: 'Sprint progress and tickets',
    icon: 'file-text',
  },
  {
    id: 'hr',
    label: 'HR',
    description: 'Team utilization and adoption',
    icon: 'heart',
  },
  // Executive roles (Phase 1)
  {
    id: 'cto',
    label: 'CTO',
    description: 'Executive ROI and strategy',
    icon: 'building2',
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Budget and cost management',
    icon: 'wallet',
  },
];

const iconMap: Record<string, React.ReactNode> = {
  code: <Code className="h-5 w-5" />,
  users: <Users className="h-5 w-5" />,
  server: <Server className="h-5 w-5" />,
  shield: <Shield className="h-5 w-5" />,
  'test-tube': <TestTube className="h-5 w-5" />,
  compass: <Compass className="h-5 w-5" />,
  'file-text': <FileText className="h-5 w-5" />,
  heart: <Heart className="h-5 w-5" />,
  building2: <Building2 className="h-5 w-5" />,
  wallet: <Wallet className="h-5 w-5" />,
};

interface RoleSwitcherProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  compact?: boolean;
}

export function RoleSwitcher({ currentRole, onRoleChange, compact = false }: RoleSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentConfig = roleConfigs.find((r) => r.id === currentRole) || roleConfigs[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          {iconMap[currentConfig.icon]}
          <span className="text-sm font-medium">{currentConfig.label}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50">
            {roleConfigs.map((role) => (
              <button
                key={role.id}
                onClick={() => {
                  onRoleChange(role.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  role.id === currentRole ? 'bg-cyan-50 dark:bg-cyan-900/20' : ''
                }`}
              >
                <span className={role.id === currentRole ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500'}>
                  {iconMap[role.icon]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{role.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{role.description}</p>
                </div>
                {role.id === currentRole && (
                  <Check className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
        Dashboard View
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {roleConfigs.map((role) => (
          <button
            key={role.id}
            onClick={() => onRoleChange(role.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${
              role.id === currentRole
                ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-900 dark:text-cyan-100 ring-2 ring-cyan-500'
                : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            <span className={role.id === currentRole ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500'}>
              {iconMap[role.icon]}
            </span>
            <span className="text-sm font-medium truncate">{role.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Tab-style role switcher for header
export function RoleSwitcherTabs({ currentRole, onRoleChange }: RoleSwitcherProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
      {roleConfigs.map((role) => (
        <button
          key={role.id}
          onClick={() => onRoleChange(role.id)}
          title={role.description}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            role.id === currentRole
              ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          {iconMap[role.icon]}
          <span className="hidden md:inline">{role.label}</span>
        </button>
      ))}
    </div>
  );
}

// Hook for managing role state
export function useRoleState(defaultRole: UserRole = 'engineer') {
  const [currentRole, setCurrentRole] = useState<UserRole>(() => {
    const saved = localStorage.getItem('dashboard-role');
    return (saved as UserRole) || defaultRole;
  });

  const handleRoleChange = (role: UserRole) => {
    setCurrentRole(role);
    localStorage.setItem('dashboard-role', role);
  };

  return { currentRole, setCurrentRole: handleRoleChange };
}

export default RoleSwitcher;
