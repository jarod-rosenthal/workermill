import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { Login } from "./pages/Login";
import { AuthCallback } from "./pages/AuthCallback";
import { MicrosoftCallback } from "./pages/MicrosoftCallback";
import { GitHubCallback } from "./pages/GitHubCallback";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Settings from "./pages/settings";
import LandingV0 from "./pages/LandingV0";
import StatusPage from "./pages/StatusPage";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import Billing from "./pages/Billing";
import SignupDeposit from "./pages/SignupDeposit";
import Analytics from "./pages/Analytics";
import CostIntelligence from "./pages/CostIntelligence";
import AcceptInvite from "./pages/AcceptInvite";
import Onboarding from "./pages/Onboarding";
import PersonaStudio from "./pages/PersonaStudio";
import PersonaDetail from "./pages/PersonaDetail";
import BoardsList from "./pages/Boards/BoardsList";
import BoardView from "./pages/Boards/BoardView";
import BoardSettings from "./pages/Boards/BoardSettings";
import SpecsList from "./pages/Specs/SpecsList";
import SpecEditor from "./pages/Specs/SpecEditor";
import Support from "./pages/Support";
import SupportTicketDetail from "./pages/SupportTicketDetail";
import Help from "./pages/Help";
import Compliance from "./pages/Compliance";
import SkillLibrary from "./pages/SkillLibrary";
import MemoryManagement from "./pages/MemoryManagement";
import DirectiveEffectiveness from "./pages/DirectiveEffectiveness";
import ManagementDashboard from "./pages/ManagementDashboard";
import IntegrationTests from "./pages/IntegrationTests";
import Demo from "./pages/Demo";
import ShowcaseViewer from "./pages/ShowcaseViewer";
import {
  DocsLayout,
  DocsOverview,
  QuickStart,
  TaskLifecycle,
  Epics as DocsEpics,
  AdvancedFeatures,
  Analytics as DocsAnalytics,
  Memory as DocsMemory,
  Personas,
  PersonaStudio as DocsPersonaStudio,
  SkillLibrary as DocsSkillLibrary,
  DirectiveEffectiveness as DocsDirectiveEffectiveness,
  Integrations,
  MCP,
  Severity,
  Metrics,
  DocsCompliance,
  AgentSetup,
  CLIDocs,
  VSCodeExtension,
  Repositories as DocsRepositories,
  CodebaseIndexing,
  SpecEngineering,
} from "./pages/Docs";
import { Terms, Privacy, Security } from "./pages/legal";
import { BlogList, BlogPost } from "./pages/Blog";
import { useAuthStore } from "./store/auth-store";
import { authAPI } from "./lib/api-client";
import { ToastProvider } from "./contexts/ToastContext";
import { TosModal } from "./components/TosModal";
import { ApiToastBridge } from "./components/ApiToastBridge";
function ProtectedRoute({ children, allowSetup = false }: { children: React.ReactNode; allowSetup?: boolean }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const needsSetup = useAuthStore((state) => state.needsSetup);
  const tosRequired = useAuthStore((state) => state.tosRequired);

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

  // Block all protected content while TOS acceptance is pending.
  // TosModal is rendered at the root level and will handle the accept flow.
  // This prevents dashboard components from firing API calls that would all
  // return 403 and pile up error toasts.
  if (tosRequired) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to onboarding if user needs to complete setup (unless allowSetup is true)
  if (needsSetup && !allowSetup) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

/** Force dark theme on public marketing pages (landing, blog, showcase, docs). */
function DarkRoute({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const _previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    return () => {
      // Restore user's theme preference when leaving
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") {
        root.setAttribute("data-theme", stored);
      } else {
        // "system" or unset — resolve from preference
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        root.setAttribute("data-theme", prefersDark ? "dark" : "light");
      }
    };
  }, []);
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
  const setTosRequired = useAuthStore((state) => state.setTosRequired);
  const _tosRequired = useAuthStore((state) => state.tosRequired);
  const organization = useAuthStore((state) => state.organization);

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
        // Check TOS from /me response — block app before any dashboard API calls fire
        if (me.currentTosVersion && me.user.tosVersion !== me.currentTosVersion) {
          setTosRequired(true);
        }
      }).catch(() => {
        // Token might be invalid, the interceptor will handle redirect
      });
    }
  }, [isInitialized, isAuthenticated, setUser, setOrganization, setNeedsSetup, setTosRequired]);

  return (
    <ToastProvider>
      <ApiToastBridge />
      <TosModal />
      <BrowserRouter>
        <Routes>
          {/* Public marketing routes — forced dark theme */}
          <Route path="/" element={<DarkRoute><LandingV0 /></DarkRoute>} />
          <Route path="/product" element={<Navigate to="/#how-it-works" replace />} />
          <Route path="/solutions" element={<Navigate to="/#showcase" replace />} />
          {/* Pricing route removed — cloud services coming soon */}
          <Route path="/blog" element={<DarkRoute><BlogList /></DarkRoute>} />
          <Route path="/blog/:slug" element={<DarkRoute><BlogPost /></DarkRoute>} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/showcase/:projectId" element={<DarkRoute><ShowcaseViewer /></DarkRoute>} />
          <Route path="/demo" element={<DarkRoute><Demo /></DarkRoute>} />

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
          <Route
            path="/forgot-password"
            element={
              <LoginRoute>
                <ForgotPassword />
              </LoginRoute>
            }
          />

          {/* OAuth callback - must be public route */}
          <Route path="/auth/callback" element={<AuthCallback />} />
          {/* Microsoft OAuth callback - separate from Cognito */}
          <Route path="/auth/microsoft/callback" element={<MicrosoftCallback />} />
          <Route path="/auth/github/callback" element={<GitHubCallback />} />

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

          {/* Public docs - accessible without authentication, forced dark */}
          <Route path="/docs" element={<DarkRoute><DocsLayout /></DarkRoute>}>
            <Route index element={<DocsOverview />} />
            <Route path="quick-start" element={<QuickStart />} />
            <Route path="cli" element={<CLIDocs />} />
            <Route path="agent" element={<AgentSetup />} />
            <Route
              path="local-agent"
              element={<Navigate to="/docs/agent" replace />}
            />
            <Route
              path="remote-agent"
              element={<Navigate to="/docs/agent" replace />}
            />
            <Route
              path="vscode-extension"
              element={<VSCodeExtension />}
            />
            <Route path="repositories" element={<DocsRepositories />} />
            <Route path="codebase-indexing" element={<CodebaseIndexing />} />
            <Route path="task-lifecycle" element={<TaskLifecycle />} />
            <Route path="epics" element={<DocsEpics />} />
            <Route path="specifications" element={<SpecEngineering />} />
            <Route path="advanced-features" element={<AdvancedFeatures />} />
            <Route path="analytics" element={<DocsAnalytics />} />
            <Route path="memory" element={<DocsMemory />} />
            <Route path="personas" element={<Personas />} />
            <Route path="persona-studio" element={<DocsPersonaStudio />} />
            <Route path="skill-library" element={<DocsSkillLibrary />} />
            <Route path="directive-effectiveness" element={<DocsDirectiveEffectiveness />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="mcp" element={<MCP />} />
            <Route path="severity" element={<Severity />} />
            <Route path="metrics" element={<Metrics />} />
            <Route path="compliance" element={<DocsCompliance />} />
          </Route>

          {/* Legal pages */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/security" element={<Security />} />

          {/* Protected routes */}
          {/* Build is now on homepage — redirect legacy /build URL */}
          <Route path="/build" element={<Navigate to="/" replace />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
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
          {/* Kanban Boards */}
          <Route
            path="/boards"
            element={
              <ProtectedRoute>
                <BoardsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boards/:boardId"
            element={
              <ProtectedRoute>
                <BoardView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boards/:boardId/settings"
            element={
              <ProtectedRoute>
                <BoardSettings />
              </ProtectedRoute>
            }
          />
          {/* Specifications */}
          <Route
            path="/specs"
            element={
              <ProtectedRoute>
                <SpecsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/specs/:specId"
            element={
              <ProtectedRoute>
                <SpecEditor />
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
          {/* Compliance Center — enterprise plan only */}
          {organization?.plan === 'enterprise' && (
            <Route
              path="/compliance"
              element={
                <ProtectedRoute>
                  <Compliance />
                </ProtectedRoute>
              }
            />
          )}
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
          {/* Integration Tests (local dev only) */}
          <Route
            path="/integration-tests"
            element={
              <ProtectedRoute>
                <IntegrationTests />
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

          {/* Legacy routes redirect to /boards */}
          <Route path="/projects" element={<Navigate to="/boards" replace />} />
          <Route path="/projects/:id" element={<Navigate to="/boards" replace />} />
          <Route path="/epics" element={<Navigate to="/boards" replace />} />
          <Route path="/epics/:id" element={<Navigate to="/boards" replace />} />

          {/* 404 */}
          <Route path="*" element={
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
              <div className="text-center max-w-md">
                <p className="text-7xl font-bold text-muted-foreground/30 mb-4">404</p>
                <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
                <p className="text-muted-foreground mb-6">The page you're looking for doesn't exist or has been moved.</p>
                <a href="/" className="inline-block px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 transition-colors">
                  Go Home
                </a>
              </div>
            </div>
          } />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
