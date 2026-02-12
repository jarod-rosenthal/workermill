import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  Save,
  Loader2,
  Trash2,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { MfaSetupModal } from "../components/MfaSetupModal";
import { MfaDisableModal } from "../components/MfaDisableModal";

const API_URL = import.meta.env.VITE_API_URL || "";

interface UserPreferences {
  theme?: "system" | "dark" | "light";
  dashboard?: {
    statsCollapsed?: boolean;
    managerCollapsed?: boolean;
  };
  // Note: Email notification preferences are managed in Settings > Notifications
}

export default function Profile() {
  const navigate = useNavigate();
  const { user, tokens, setUser, logout } = useAuthStore();

  // Profile state
  const [displayName, setDisplayName] = useState(user?.fullName || "");
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [profileLoading, setProfileLoading] = useState(true);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [showMfaSetupModal, setShowMfaSetupModal] = useState(false);
  const [showMfaDisableModal, setShowMfaDisableModal] = useState(false);

  // Loading states
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Message state
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch profile data
  const fetchProfile = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      const res = await fetch(`${API_URL}/api/profile`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        setDisplayName(data.user.fullName || "");
        setPreferences(data.preferences || {});
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setProfileLoading(false);
    }
  }, [tokens?.accessToken]);

  // Fetch MFA status
  const fetchMfaStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      const res = await fetch(`${API_URL}/api/profile/mfa/status`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        setMfaEnabled(data.mfaEnabled);
      }
    } catch (error) {
      console.error("Failed to fetch MFA status:", error);
    } finally {
      setMfaLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    fetchProfile();
    fetchMfaStatus();
  }, [fetchProfile, fetchMfaStatus]);

  // Save profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_URL}/api/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ fullName: displayName, preferences }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "Profile updated successfully" });
        if (user) {
          setUser({ ...user, fullName: displayName });
        }
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update profile" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update profile" });
    } finally {
      setSavingProfile(false);
    }
  };

  // Change password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New passwords do not match" });
      return;
    }

    setChangingPassword(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_URL}/api/profile/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "Password changed successfully" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to change password" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to change password" });
    } finally {
      setChangingPassword(false);
    }
  };

  // Sign out all sessions
  const handleSignOutAll = async () => {
    setSigningOutAll(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_URL}/api/profile/sign-out-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: data.message });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to sign out all sessions" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to sign out all sessions" });
    } finally {
      setSigningOutAll(false);
    }
  };

  // Delete account
  const handleDeleteAccount = async () => {
    if (deleteConfirmText.toUpperCase() !== "DELETE") return;

    setDeletingAccount(true);

    try {
      const res = await fetch(`${API_URL}/api/profile/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ confirmText: deleteConfirmText }),
      });

      if (res.ok) {
        logout();
        navigate("/login");
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to delete account" });
        setShowDeleteModal(false);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to delete account" });
      setShowDeleteModal(false);
    } finally {
      setDeletingAccount(false);
      setDeleteConfirmText("");
    }
  };

  // Update preference helper
  const _updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="relative max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold text-foreground">Profile</h1>

        {message && (
          <div
            className={`p-4 rounded-lg border ${
              message.type === "success"
                ? "bg-green-500/10 border-green-500/30 text-green-500"
                : "bg-red-500/10 border-red-500/30 text-red-500"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Personal Information Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              Personal Information
            </h2>
          </div>
          <form onSubmit={handleSaveProfile} className="p-6 space-y-4" data-testid="profile-form">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <User className="w-4 h-4" />
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                data-testid="profile-name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email
              </label>
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border text-muted-foreground cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-lg hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50"
            >
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </form>
        </div>

        {/* Security Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-orange-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <Lock className="w-4 h-4 text-orange-500" />
              </div>
              Security
            </h2>
          </div>
          <form onSubmit={handleChangePassword} className="p-6 space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-muted-foreground mb-2">Current Password</label>
              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all pr-12"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-9 text-muted-foreground hover:text-foreground"
              >
                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-muted-foreground mb-2">New Password</label>
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all pr-12"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-9 text-muted-foreground hover:text-foreground"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                Min 8 characters with uppercase, lowercase, and number
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-all disabled:opacity-50"
            >
              {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Change Password
            </button>
          </form>
        </div>

        {/* MFA Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-green-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Shield className="w-4 h-4 text-green-500" />
              </div>
              Two-Factor Authentication
            </h2>
          </div>
          <div className="p-6">
            {mfaLoading ? (
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Loading MFA status...</span>
              </div>
            ) : mfaEnabled ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <ShieldCheck className="w-6 h-6 text-green-500" />
                  <div>
                    <p className="font-medium text-green-500">MFA is enabled</p>
                    <p className="text-sm text-green-500/80">
                      Your account is protected with two-factor authentication via authenticator app.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMfaDisableModal(true)}
                  className="flex items-center gap-2 px-4 py-2 border border-red-500/50 text-red-500 font-semibold rounded-lg hover:bg-red-500/10 transition-all"
                >
                  <ShieldOff className="w-4 h-4" />
                  Disable MFA
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Add an extra layer of security to your account by enabling two-factor authentication.
                  You'll need an authenticator app like Google Authenticator, Authy, or 1Password.
                </p>
                <button
                  onClick={() => setShowMfaSetupModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-all"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Enable MFA
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sessions Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-indigo-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <RefreshCw className="w-4 h-4 text-indigo-500" />
              </div>
              Sessions
            </h2>
          </div>
          <div className="p-6">
            <p className="text-muted-foreground mb-4">
              Sign out of all other devices and browser sessions. Your current session will remain active.
            </p>
            <button
              onClick={handleSignOutAll}
              disabled={signingOutAll}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition-all disabled:opacity-50"
            >
              {signingOutAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Sign Out All Other Sessions
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="card-elevated border border-red-500/30 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-red-500/30 bg-gradient-to-r from-red-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              Danger Zone
            </h2>
          </div>
          <div className="p-6">
            <p className="text-muted-foreground mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Delete Account
            </button>
          </div>
        </div>
      </main>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Delete Account
            </h3>
            <p className="text-muted-foreground mb-4">
              This will permanently delete your account and all associated data. Type <span className="font-mono font-semibold text-red-400">DELETE</span> to confirm.
            </p>
            <div className="mb-4">
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 focus:outline-none transition-all font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText("");
                }}
                className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount || deleteConfirmText.toUpperCase() !== "DELETE"}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MFA Setup Modal */}
      <MfaSetupModal
        isOpen={showMfaSetupModal}
        onClose={() => setShowMfaSetupModal(false)}
        onSuccess={() => {
          setMfaEnabled(true);
          setMessage({ type: "success", text: "Two-factor authentication has been enabled" });
        }}
        accessToken={tokens?.accessToken || ""}
      />

      {/* MFA Disable Modal */}
      <MfaDisableModal
        isOpen={showMfaDisableModal}
        onClose={() => setShowMfaDisableModal(false)}
        onSuccess={() => {
          setMfaEnabled(false);
          setMessage({ type: "success", text: "Two-factor authentication has been disabled" });
        }}
        accessToken={tokens?.accessToken || ""}
      />
    </div>
  );
}
