import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { Login } from "./pages/Login";
import { AuthCallback } from "./pages/AuthCallback";
import { MicrosoftCallback } from "./pages/MicrosoftCallback";
import Dashboard from "./pages/Dashboard";
import { RoleBasedDashboard } from "./pages/Dashboard/index";
import SetupWizard from "./pages/SetupWizard";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import LandingV0 from "./pages/LandingV0";
import StatusPage from "./pages/StatusPage";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import Billing from "./pages/Billing";
import SignupDeposit from "./pages/SignupDeposit";
import Analytics from "./pages/Analytics";
import CostIntelligence from "./pages/CostIntelligence";
import AcceptInvite from "./pages/AcceptInvite";
import Onboarding from "./pages/Onboarding";
import PersonaStudio from "./pages/PersonaStudio";
import PersonaDetail from "./pages/PersonaDetail";
import Epics from "./pages/Projects";
import EpicBoard from "./pages/ProjectBoard";
import EpicSettings from "./pages/ProjectSettings";
import Support from "./pages/Support";
import SupportTicketDetail from "./pages/SupportTicketDetail";
import Help from "./pages/Help";
import Compliance from "./pages/Compliance";
import SkillLibrary from "./pages/SkillLibrary";
import MemoryManagement from "./pages/MemoryManagement";
import DirectiveEffectiveness from "./pages/DirectiveEffectiveness";
import ManagementDashboard from "./pages/ManagementDashboard";
import {
  DocsLayout,
  DocsOverview,
  QuickStart,
  TaskLifecycle,
  AdvancedFeatures,
  Personas,
  Integrations,
  Severity,
  Metrics,
} from "./pages/Docs";
import { Terms, Privacy, Security } from "./pages/legal";
import { BlogList, BlogPost } from "./pages/Blog";
import { useAuthStore } from "./store/auth-store";
import { authAPI } from "./lib/api-client";
import { ToastProvider } from "./contexts/ToastContext";
import { ApiToastBridge } from "./components/ApiToastBridge";
function ProtectedRoute({ children, allowSetup = false }: { children: React.ReactNode; allowSetup?: boolean }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const needsSetup = useAuthStore((state) => state.needsSetup);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Redirect to onboarding if user needs to complete setup (unless allowSetup is true)
  if (needsSetup && !allowSetup) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function LoginRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect authenticated users from login to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function App() {
  const initializeAuth = useAuthStore((state) => state.initialize);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const setUser = useAuthStore((state) => state.setUser);
  const setOrganization = useAuthStore((state) => state.setOrganization);
  const setNeedsSetup = useAuthStore((state) => state.setNeedsSetup);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Fetch user data after initialization if authenticated
  useEffect(() => {
    if (isInitialized && isAuthenticated) {
      authAPI.getMe().then((me) => {
        setUser(me.user);
        setOrganization(me.organization);
        setNeedsSetup(me.needsSetup);
      }).catch(() => {
        // Token might be invalid, the interceptor will handle redirect
      });
    }
  }, [isInitialized, isAuthenticated, setUser, setOrganization, setNeedsSetup]);

  return (
    <ToastProvider>
      <ApiToastBridge />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingV0 />} />
          <Route path="/product" element={<Navigate to="/#product" replace />} />
          <Route path="/solutions" element={<Navigate to="/#solutions" replace />} />
          <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
          <Route path="/blog" element={<BlogList />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/status" element={<StatusPage />} />

          <Route
            path="/login"
            element={
              <LoginRoute>
                <Login />
              </LoginRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <LoginRoute>
                <Signup />
              </LoginRoute>
            }
          />
          <Route
            path="/verify-email"
            element={
              <LoginRoute>
                <VerifyEmail />
              </LoginRoute>
            }
          />

          {/* OAuth callback - must be public route */}
          <Route path="/auth/callback" element={<AuthCallback />} />
          {/* Microsoft OAuth callback - separate from Cognito */}
          <Route path="/auth/microsoft/callback" element={<MicrosoftCallback />} />

          {/* Public invite acceptance */}
          <Route path="/invites/:token" element={<AcceptInvite />} />

          {/* Onboarding - for authenticated users without org */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute allowSetup>
                <Onboarding />
              </ProtectedRoute>
            }
          />

          {/* Public docs */}
          <Route path="/docs" element={<DocsLayout />}>
            <Route index element={<DocsOverview />} />
            <Route path="quick-start" element={<QuickStart />} />
            <Route path="task-lifecycle" element={<TaskLifecycle />} />
            <Route path="advanced-features" element={<AdvancedFeatures />} />
            <Route path="personas" element={<Personas />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="severity" element={<Severity />} />
            <Route path="metrics" element={<Metrics />} />
          </Route>

          {/* Legal pages */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/security" element={<Security />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/setup"
            element={
              <ProtectedRoute>
                <SetupWizard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute>
                <Billing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing/deposit"
            element={
              <ProtectedRoute>
                <SignupDeposit />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cost-intelligence"
            element={
              <ProtectedRoute>
                <CostIntelligence />
              </ProtectedRoute>
            }
          />
          <Route
            path="/views"
            element={
              <ProtectedRoute>
                <RoleBasedDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/personas"
            element={
              <ProtectedRoute>
                <PersonaStudio />
              </ProtectedRoute>
            }
          />
          <Route
            path="/personas/:id"
            element={
              <ProtectedRoute>
                <PersonaDetail />
              </ProtectedRoute>
            }
          />
          {/* Epics (formerly Projects) */}
          <Route
            path="/epics"
            element={
              <ProtectedRoute>
                <Epics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/epics/:id"
            element={
              <ProtectedRoute>
                <EpicBoard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/epics/:id/settings"
            element={
              <ProtectedRoute>
                <EpicSettings />
              </ProtectedRoute>
            }
          />
          {/* Help & Support */}
          <Route
            path="/help"
            element={
              <ProtectedRoute>
                <Help />
              </ProtectedRoute>
            }
          />
          {/* Support Admin (for support admins only) */}
          <Route
            path="/support"
            element={
              <ProtectedRoute>
                <Support />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support/:ticketKey"
            element={
              <ProtectedRoute>
                <SupportTicketDetail />
              </ProtectedRoute>
            }
          />
          {/* Compliance Center */}
          <Route
            path="/compliance"
            element={
              <ProtectedRoute>
                <Compliance />
              </ProtectedRoute>
            }
          />
          {/* Memory & Learning */}
          <Route
            path="/skills"
            element={
              <ProtectedRoute>
                <SkillLibrary />
              </ProtectedRoute>
            }
          />
          <Route
            path="/memory"
            element={
              <ProtectedRoute>
                <MemoryManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/directive-effectiveness"
            element={
              <ProtectedRoute>
                <DirectiveEffectiveness />
              </ProtectedRoute>
            }
          />
          {/* Platform Management (platform admins only) */}
          <Route
            path="/management"
            element={
              <ProtectedRoute>
                <ManagementDashboard />
              </ProtectedRoute>
            }
          />

          {/* Legacy /projects routes redirect to /epics */}
          <Route path="/projects" element={<Navigate to="/epics" replace />} />
          <Route path="/projects/:id" element={<Navigate to="/epics" replace />} />
          <Route path="/projects/:id/settings" element={<Navigate to="/epics" replace />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
