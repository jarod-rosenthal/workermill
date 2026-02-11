import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  User,
  Settings,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  Rocket,
  MessageSquare,
  Book,
  HelpCircle,
  Building2,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { useThemeStore } from "../store/theme-store";

interface ProfileDropdownProps {
  className?: string;
  onShowQuickStart?: () => void;
}

/**
 * Decode JWT token payload without verification
 * Used to extract user info like avatar from idToken
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Get user initials from full name or email
 */
function getInitials(fullName: string | null | undefined, email: string | undefined): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return fullName.substring(0, 2).toUpperCase();
  }
  if (email) {
    return email.substring(0, 2).toUpperCase();
  }
  return "??";
}

export function ProfileDropdown({ className = "", onShowQuickStart }: ProfileDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user, tokens, logout } = useAuthStore();
  const { theme, setTheme } = useThemeStore();

  // Check if user has support admin access (from database flag)
  const hasSupportAccess = user?.supportAdmin === true;

  // Check if user has platform admin access (from /api/auth/me response)
  const hasPlatformAccess = user?.isPlatformAdmin === true;

  // Extract avatar URL from idToken (Google SSO provides picture claim)
  const avatarUrl = tokens?.idToken
    ? (decodeJwtPayload(tokens.idToken)?.picture as string | undefined)
    : undefined;

  const initials = getInitials(user?.fullName, user?.email);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close dropdown on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const themeOptions = [
    { value: "system" as const, label: "System", icon: Monitor },
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
  ];

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 p-0.5 rounded-full hover:ring-2 hover:ring-primary/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/50"
        title={user?.fullName || user?.email || "Profile"}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={user?.fullName || "Profile"}
            className="w-8 h-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
            {initials}
          </div>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-card border border-border shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={user?.fullName || "Profile"}
                  className="w-10 h-10 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user?.fullName || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email}
                </p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <Link
              to="/profile"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <User className="w-4 h-4 text-muted-foreground" />
              Profile
            </Link>
            <Link
              to="/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Settings
            </Link>
            <Link
              to="/docs"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <Book className="w-4 h-4 text-muted-foreground" />
              Documentation
            </Link>
            <Link
              to="/help"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
            >
              <HelpCircle className="w-4 h-4 text-muted-foreground" />
              Help & Support
            </Link>
            {hasSupportAccess && (
              <Link
                to="/support"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Support Admin
              </Link>
            )}
            {hasPlatformAccess && (
              <Link
                to="/management"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
              >
                <Building2 className="w-4 h-4 text-muted-foreground" />
                Platform Management
              </Link>
            )}
            {onShowQuickStart && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onShowQuickStart();
                }}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors w-full"
              >
                <Rocket className="w-4 h-4 text-muted-foreground" />
                Quick Start
              </button>
            )}
          </div>

          {/* Theme Selector */}
          <div className="px-4 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Theme</p>
            <div className="flex gap-1">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const isActive = theme === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setTheme(option.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    title={option.label}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Logout */}
          <div className="py-1 border-t border-border">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors w-full"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
