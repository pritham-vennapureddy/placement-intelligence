import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { Button } from "./components/ui/button";
import { AuthProvider, useAuth } from "./contexts/auth-context";
import { DashboardPage } from "./pages/dashboard-page";
import { LoginPage } from "./pages/login-page";
import { TeamsPage } from "./pages/teams-page";
import { SheetsPage } from "./pages/sheets-page";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function SessionGate() {
  const { status, error, retrySession, user } = useAuth();

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Restoring your session…</div>;
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="max-w-md text-sm text-rose-700">{error}</p>
        <Button onClick={() => void retrySession()}>Retry session</Button>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={status === "authenticated" ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        element={status === "authenticated" ? <AppShell /> : <Navigate to="/login" replace />}
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/companies" element={<DashboardPage />} />
        <Route path="/assessed-pool" element={<DashboardPage />} />
        <Route path="/sheets" element={<SheetsPage />} />
        <Route path="/psm-workspace" element={<DashboardPage />} />
        <Route
          path="/teams"
          element={user?.roles.some((role) => role === "ADMIN" || role === "MANAGER") ? <TeamsPage /> : <Navigate to="/" replace />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <SessionGate />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
