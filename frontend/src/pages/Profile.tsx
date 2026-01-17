import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  Save,
  Loader2,
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Sun,
  Moon,
  Monitor,
  Bell,
  Layout,
  Eye,
  EyeOff,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_URL = import.meta.env.VITE_API_URL || "";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface UserPreferences {
  theme?: "system" | "dark" | "light";
  notifications?: {
    taskCompleted?: boolean;
    taskFailed?: boolean;
    costAlerts?: boolean;
  };
  dashboard?: {
    statsCollapsed?: boolean;
    managerCollapsed?: boolean;
  };
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

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  // Loading states
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
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

  // Fetch API keys
  const fetchApiKeys = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      const res = await fetch(`${API_URL}/api/profile/api-keys`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.apiKeys);
      }
    } catch (error) {
      console.error("Failed to fetch API keys:", error);
    } finally {
      setApiKeysLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    fetchProfile();
    fetchApiKeys();
  }, [fetchProfile, fetchApiKeys]);

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

  // Create API key
  const handleCreateApiKey = async () => {
    if (!newKeyName.trim()) return;

    setCreatingKey(true);

    try {
      const res = await fetch(`${API_URL}/api/profile/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setCreatedToken(data.token);
        setApiKeys([data.apiKey, ...apiKeys]);
        setNewKeyName("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create API key" });
        setShowCreateKeyModal(false);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to create API key" });
      setShowCreateKeyModal(false);
    } finally {
      setCreatingKey(false);
    }
  };

  // Delete API key
  const handleDeleteApiKey = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/profile/api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });

      if (res.ok) {
        setApiKeys(apiKeys.filter((k) => k.id !== id));
        setMessage({ type: "success", text: "API key revoked" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to revoke API key" });
    }
  };

  // Copy token to clipboard
  const handleCopyToken = async () => {
    if (createdToken) {
      await navigator.clipboard.writeText(createdToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
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
    if (!deletePassword) return;

    setDeletingAccount(true);

    try {
      const res = await fetch(`${API_URL}/api/profile/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ password: deletePassword }),
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
      setDeletePassword("");
    }
  };

  // Update preference helper
  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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
          <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
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

        {/* Preferences Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-purple-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Layout className="w-4 h-4 text-purple-500" />
              </div>
              Preferences
            </h2>
          </div>
          <div className="p-6 space-y-6">
            {/* Theme */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Sun className="w-4 h-4" />
                Theme
              </label>
              <div className="flex gap-2">
                {[
                  { value: "system", label: "System", icon: Monitor },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updatePreference("theme", option.value as "system" | "dark" | "light")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                      (preferences.theme || "system") === option.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <option.icon className="w-4 h-4" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notifications */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Notifications
              </label>
              <div className="space-y-3">
                {[
                  { key: "taskCompleted", label: "Task completed" },
                  { key: "taskFailed", label: "Task failed" },
                  { key: "costAlerts", label: "Cost alerts" },
                ].map((option) => (
                  <label key={option.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.notifications?.[option.key as keyof typeof preferences.notifications] ?? true}
                      onChange={(e) =>
                        setPreferences((prev) => ({
                          ...prev,
                          notifications: {
                            ...prev.notifications,
                            [option.key]: e.target.checked,
                          },
                        }))
                      }
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-foreground">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white font-semibold rounded-lg hover:bg-purple-600 transition-all disabled:opacity-50"
            >
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Preferences
            </button>
          </div>
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

        {/* API Keys Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-cyan-500/10 to-transparent flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <Key className="w-4 h-4 text-cyan-500" />
              </div>
              API Keys
            </h2>
            <button
              onClick={() => setShowCreateKeyModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500 text-white text-sm font-semibold rounded-lg hover:bg-cyan-600 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Key
            </button>
          </div>
          <div className="p-6">
            {apiKeysLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : apiKeys.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No API keys yet. Create one to access the API programmatically.
              </p>
            ) : (
              <div className="space-y-3">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between p-4 bg-background/50 rounded-lg border border-border"
                  >
                    <div>
                      <p className="font-medium text-foreground">{key.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <code className="bg-muted px-1.5 py-0.5 rounded">{key.keyPrefix}...</code>
                        <span className="mx-2">|</span>
                        Created {formatDate(key.createdAt)}
                        {key.lastUsedAt && <span className="mx-2">| Last used {formatDate(key.lastUsedAt)}</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteApiKey(key.id)}
                      className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Revoke key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
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

      {/* Create API Key Modal */}
      {showCreateKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6">
            {createdToken ? (
              <>
                <h3 className="text-lg font-semibold text-foreground mb-4">API Key Created</h3>
                <p className="text-muted-foreground mb-4">
                  Copy your API key now. You won't be able to see it again!
                </p>
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-4">
                  <code className="flex-1 text-sm break-all">{createdToken}</code>
                  <button
                    onClick={handleCopyToken}
                    className="p-2 hover:bg-background rounded transition-colors"
                  >
                    {copiedToken ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setShowCreateKeyModal(false);
                    setCreatedToken(null);
                  }}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-all"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground mb-4">Create API Key</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Key Name</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., CLI Access"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreateKeyModal(false)}
                    className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateApiKey}
                    disabled={creatingKey || !newKeyName.trim()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-cyan-500 text-white font-semibold rounded-lg hover:bg-cyan-600 transition-all disabled:opacity-50"
                  >
                    {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Delete Account
            </h3>
            <p className="text-muted-foreground mb-4">
              This will permanently delete your account and all associated data. Enter your password to confirm.
            </p>
            <div className="mb-4">
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 focus:outline-none transition-all"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword("");
                }}
                className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount || !deletePassword}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
