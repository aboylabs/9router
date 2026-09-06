import { useState } from "react";
import { ToastProvider } from "./components/ui/Toast";
import { Sidebar, type Page } from "./components/Sidebar";
import { useAuth } from "./hooks/useAuth";
import { useDashboard } from "./hooks/useDashboard";
import { useTheme } from "./hooks/useTheme";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Keys } from "./pages/Keys";
import { Models } from "./pages/Models";
import { Usage } from "./pages/Usage";
import { Requests } from "./pages/Requests";
import { Live } from "./pages/Live";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  useTheme();
  const { admin, login, logout, error, isLoading } = useAuth();
  const [page, setPage] = useState<Page>("overview");

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-surface-secondary">
        <div className="flex items-center gap-3 text-text-muted">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading...</span>
        </div>
      </main>
    );
  }

  if (!admin) {
    return <Login onLogin={login} error={error} />;
  }

  return <Dashboard adminEmail={admin.email} page={page} onNavigate={setPage} onLogout={logout} />;
}

function Dashboard({ adminEmail, page, onNavigate, onLogout }: {
  adminEmail: string;
  page: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}) {
  const { models, keys, usage, overview, chartData, chartRange, setChartRange, refreshChart, loading, refresh } = useDashboard();

  return (
    <div className="min-h-screen bg-surface-secondary flex flex-col">
      <Sidebar
        currentPage={page}
        onNavigate={onNavigate}
        adminEmail={adminEmail}
        onLogout={onLogout}
      />

      <main className="flex-1 p-3 sm:p-5 lg:p-8 overflow-auto min-h-0">
        <div className="max-w-[1600px] mx-auto page-enter">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <svg className="animate-spin h-6 w-6 text-primary-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : (
            <>
              {page === "overview" && <Overview overview={overview} chartData={chartData} chartRange={chartRange} setChartRange={(r) => { setChartRange(r); refreshChart(r); }} />}
              {page === "keys" && <Keys keys={keys} onRefresh={refresh} />}
              {page === "models" && <Models models={models} onRefresh={refresh} />}
              {page === "usage" && <Usage usage={usage} />}
              {page === "requests" && <Requests />}
              {page === "live" && <Live />}
              {page === "settings" && <Settings />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
