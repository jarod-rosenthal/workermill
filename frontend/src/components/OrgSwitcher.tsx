import { useState, useEffect, useRef } from "react";
import { Building2, ChevronDown, Check, Crown, Shield, User } from "lucide-react";
import { organizationsAPI, type UserOrganization } from "../lib/api-client";
import { useAuthStore } from "../store/auth-store";
import { useToast } from "../contexts/ToastContext";

interface OrgSwitcherProps {
  className?: string;
}

export function OrgSwitcher({ className = "" }: OrgSwitcherProps) {
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { organization, setOrganization } = useAuthStore();
  const toast = useToast();

  // Fetch organizations on mount
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const orgs = await organizationsAPI.list();
        setOrganizations(orgs);
      } catch {
        toast.error("Failed to load organizations");
      } finally {
        setIsLoading(false);
      }
    };
    fetchOrgs();
  }, [toast]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSwitchOrg = async (org: UserOrganization) => {
    if (org.id === organization?.id || isSwitching) return;

    setIsSwitching(true);
    try {
      const result = await organizationsAPI.switchOrg(org.id);
      setOrganization({ id: org.id, name: org.name, plan: (result.organization as Record<string, unknown>).plan as string || "pro", trialExpiresAt: null, stripeSubscriptionStatus: null });
      setIsOpen(false);
      // Reload to refresh all data with new org context
      window.location.reload();
    } catch {
      toast.error("Failed to switch organization");
    } finally {
      setIsSwitching(false);
    }
  };

  const getRoleIcon = (role: UserOrganization["role"]) => {
    switch (role) {
      case "owner":
        return <Crown className="w-3 h-3 text-yellow-500" />;
      case "admin":
        return <Shield className="w-3 h-3 text-blue-500" />;
      default:
        return <User className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const currentOrg = organizations.find((o) => o.id === organization?.id) || organizations[0];

  if (isLoading) return null;

  // Single org — show non-interactive label
  if (organizations.length <= 1) {
    const name = currentOrg?.name || organization?.name;
    if (!name) return null;
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-muted-foreground ${className}`}>
        <Building2 className="w-4 h-4" />
        <span className="max-w-[150px] truncate">{name}</span>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted/50 hover:bg-muted border border-border/50 transition-all"
      >
        <Building2 className="w-4 h-4 text-muted-foreground" />
        <span className="max-w-[150px] truncate">{currentOrg?.name || organization?.name}</span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden backdrop-blur-sm">
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Switch Organization
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSwitchOrg(org)}
                disabled={isSwitching}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all ${
                  org.id === organization?.id
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "hover:bg-muted/80 text-foreground border border-transparent"
                } ${isSwitching ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className={`p-2 rounded-lg ${org.id === organization?.id ? "bg-primary/20" : "bg-muted"}`}>
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{org.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    {getRoleIcon(org.role)}
                    <span className="capitalize">{org.role}</span>
                    {org.isDefault && (
                      <span className="text-primary font-medium">(default)</span>
                    )}
                  </p>
                </div>
                {org.id === organization?.id && (
                  <Check className="w-5 h-5 text-primary flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
