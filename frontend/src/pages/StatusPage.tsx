import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";

type ServiceStatus = "operational" | "degraded" | "outage";

interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  checkedAt: string;
  responseTime?: number;
  message?: string;
}

interface StatusResponse {
  status: ServiceStatus;
  timestamp: string;
  services: {
    api: ServiceHealth;
    database: ServiceHealth;
    taskProcessing: ServiceHealth;
    cdn: ServiceHealth;
  };
}

const STATUS_CONFIG = {
  operational: {
    label: "Operational",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/20",
    borderColor: "border-emerald-500/30",
    pulseColor: "bg-emerald-400",
  },
  degraded: {
    label: "Degraded",
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
    borderColor: "border-amber-500/30",
    pulseColor: "bg-amber-400",
  },
  outage: {
    label: "Outage",
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-500/30",
    pulseColor: "bg-red-400",
  },
};

const SERVICE_DESCRIPTIONS = {
  api: "Handles all API requests, authentication, and webhook processing",
  database: "PostgreSQL database for task state, logs, and user data",
  taskProcessing: "Orchestrator that claims and dispatches worker tasks",
  cdn: "CDN serving the dashboard and static assets",
};

const SERVICE_ICONS = {
  api: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
    </svg>
  ),
  database: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  ),
  taskProcessing: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  cdn: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  ),
};

function StatusIndicator({ status, size = "md" }: { status: ServiceStatus; size?: "sm" | "md" | "lg" }) {
  const config = STATUS_CONFIG[status];
  const sizeClasses = {
    sm: "h-2.5 w-2.5",
    md: "h-3.5 w-3.5",
    lg: "h-5 w-5",
  };

  return (
    <span className={`relative flex ${sizeClasses[size]}`}>
      <span
        className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pulseColor} opacity-75`}
      />
      <span
        className={`relative inline-flex rounded-full h-full w-full ${config.pulseColor}`}
      />
    </span>
  );
}

function ServiceCard({ service, serviceKey }: { service: ServiceHealth; serviceKey: keyof typeof SERVICE_DESCRIPTIONS }) {
  const config = STATUS_CONFIG[service.status];
  const description = SERVICE_DESCRIPTIONS[serviceKey];
  const icon = SERVICE_ICONS[serviceKey];

  return (
    <div
      className={`bg-slate-900/60 backdrop-blur-sm rounded-2xl border ${config.borderColor} p-8 transition-all hover:bg-slate-900/80`}
    >
      <div className="flex items-start justify-between mb-6">
        <div className={`${config.color} opacity-80`}>
          {icon}
        </div>
        <StatusIndicator status={service.status} size="lg" />
      </div>

      <h3 className="text-xl font-semibold text-white mb-2">{service.name}</h3>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">{description}</p>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-sm">Status</span>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${config.bgColor} ${config.color}`}
          >
            {config.label}
          </span>
        </div>

        {service.responseTime !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-slate-500 text-sm">Response Time</span>
            <span className="text-slate-300 text-sm font-mono">{service.responseTime}ms</span>
          </div>
        )}

        {service.message && (
          <div className="flex items-center justify-between">
            <span className="text-slate-500 text-sm">Details</span>
            <span className="text-slate-300 text-sm">{service.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function OverallStatusHero({
  status,
  timestamp,
}: {
  status: ServiceStatus;
  timestamp: string;
}) {
  const config = STATUS_CONFIG[status];

  const statusText = {
    operational: "All Systems Operational",
    degraded: "Partial System Degradation",
    outage: "System Outage Detected",
  };

  const statusSubtext = {
    operational: "All WorkerMill services are running normally",
    degraded: "Some services are experiencing issues",
    outage: "We are aware of the issue and working on a fix",
  };

  return (
    <div className="text-center mb-20">
      <div className="inline-flex items-center gap-5 mb-4">
        <StatusIndicator status={status} size="lg" />
        <h1 className={`text-5xl md:text-6xl font-bold ${config.color}`}>
          {statusText[status]}
        </h1>
        <StatusIndicator status={status} size="lg" />
      </div>
      <p className="text-slate-300 text-xl mb-4">{statusSubtext[status]}</p>
      <p className="text-slate-500">
        Last checked: {new Date(timestamp).toLocaleString()}
      </p>
    </div>
  );
}

function SystemInfo() {
  return (
    <div className="mt-16 bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-white/5 p-8">
      <h2 className="text-2xl font-semibold text-white mb-6">Platform Overview</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <h3 className="text-slate-400 text-sm uppercase tracking-wider mb-2">Uptime Target</h3>
          <p className="text-white text-lg">99.9% Availability</p>
          <p className="text-slate-500 text-sm">Enterprise-grade reliability</p>
        </div>
        <div>
          <h3 className="text-slate-400 text-sm uppercase tracking-wider mb-2">Security</h3>
          <p className="text-white text-lg">Encrypted at Rest & Transit</p>
          <p className="text-slate-500 text-sm">SOC 2 compliant infrastructure</p>
        </div>
        <div>
          <h3 className="text-slate-400 text-sm uppercase tracking-wider mb-2">Monitoring</h3>
          <p className="text-white text-lg">Real-time Health Checks</p>
          <p className="text-slate-500 text-sm">Auto-refresh every 30 seconds</p>
        </div>
      </div>
    </div>
  );
}

function MinimalHeader() {
  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="absolute inset-0 bg-[#0a0f1a]/70 backdrop-blur-xl border-b border-white/5" />
      <div className="container relative mx-auto flex h-16 items-center justify-between px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">
            WorkerMill
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-400">System Status</span>
          <Link
            to="/login"
            className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function StatusPage() {
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }
      const data = await response.json();
      setStatusData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen relative">
      <ImmersiveBackground />
      <div className="relative z-10">
        <MinimalHeader />

        <div className="container mx-auto px-6 lg:px-8 py-20 md:py-28">
          {loading ? (
            <div className="text-center py-32">
              <div className="inline-flex items-center gap-3 text-slate-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400" />
                <span className="text-lg">Loading status...</span>
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-32">
              <div className="inline-flex items-center gap-5 mb-6">
                <StatusIndicator status="outage" size="lg" />
                <h1 className="text-5xl md:text-6xl font-bold text-red-400">
                  Unable to Fetch Status
                </h1>
                <StatusIndicator status="outage" size="lg" />
              </div>
              <p className="text-slate-400 text-xl mb-8">{error}</p>
              <button
                onClick={fetchStatus}
                className="px-8 py-4 bg-teal-500/20 text-teal-400 rounded-xl border border-teal-500/30 hover:bg-teal-500/30 transition-colors text-lg font-medium"
              >
                Retry
              </button>
            </div>
          ) : statusData ? (
            <>
              <OverallStatusHero
                status={statusData.status}
                timestamp={statusData.timestamp}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
                <ServiceCard service={statusData.services.api} serviceKey="api" />
                <ServiceCard service={statusData.services.database} serviceKey="database" />
                <ServiceCard service={statusData.services.taskProcessing} serviceKey="taskProcessing" />
                <ServiceCard service={statusData.services.cdn} serviceKey="cdn" />
              </div>

              <div className="max-w-5xl mx-auto">
                <SystemInfo />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
