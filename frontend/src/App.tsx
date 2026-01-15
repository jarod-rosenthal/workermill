import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { Login } from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import SetupWizard from "./pages/SetupWizard";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import { Home } from "./pages/Home";
import Signup from "./pages/Signup";
import Billing from "./pages/Billing";
import Analytics from "./pages/Analytics";
import {
  DocsLayout,
  DocsOverview,
  TaskLifecycle,
  AdvancedFeatures,
  Personas,
  Integrations,
  Severity,
  Metrics,
} from "./pages/Docs";
import { useAuthStore } from "./store/auth-store";
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);

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

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Home />} />

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

        {/* Public docs */}
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsOverview />} />
          <Route path="task-lifecycle" element={<TaskLifecycle />} />
          <Route path="advanced-features" element={<AdvancedFeatures />} />
          <Route path="personas" element={<Personas />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="severity" element={<Severity />} />
          <Route path="metrics" element={<Metrics />} />
        </Route>

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
          path="/analytics"
          element={
            <ProtectedRoute>
              <Analytics />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
