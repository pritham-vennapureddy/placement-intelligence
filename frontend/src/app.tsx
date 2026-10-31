import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Permission } from "@placement/shared";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider, useAuth } from "./contexts/auth-context";
import { CompaniesPage } from "./features/companies/companies-page";
import { CompanyDetailPage } from "./features/companies/company-detail-page";
import { JobRequestDetailPage } from "./features/job-requests/job-request-detail-page";
import { JobRequestFormPage } from "./features/job-requests/job-request-form-page";
import { JobRequestsPage } from "./features/job-requests/job-requests-page";
import { DashboardPage } from "./pages/dashboard-page";
import { LoginPage } from "./pages/login-page";
import { MODULE_OUTLINES, ModulePlaceholderPage } from "./pages/module-placeholder-page";
import { SheetsPage } from "./pages/sheets-page";
import { TeamsPage } from "./pages/teams-page";
import { NAV_ITEMS } from "./routes/navigation";
import { RequirePermission } from "./routes/require-permission";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const pages: Record<string, ReactNode> = {
  "/": <DashboardPage />,
  "/psm-workspace": <DashboardPage />,
  "/companies": <CompaniesPage />,
  "/job-requests": <JobRequestsPage />,
  "/candidates": <ModulePlaceholderPage module={MODULE_OUTLINES.candidates} />,
  "/assessed-pool": <DashboardPage />,
  "/screening": <ModulePlaceholderPage module={MODULE_OUTLINES.screening} />,
  "/pipeline": <ModulePlaceholderPage module={MODULE_OUTLINES.pipeline} />,
  "/psm-operations": <ModulePlaceholderPage module={MODULE_OUTLINES.psmOperations} />,
  "/rsa": <ModulePlaceholderPage module={MODULE_OUTLINES.rsa} />,
  "/imports": <ModulePlaceholderPage module={MODULE_OUTLINES.imports} />,
  "/sheets": <SheetsPage />,
  "/reports": <ModulePlaceholderPage module={MODULE_OUTLINES.reports} />,
  "/teams": <TeamsPage />,
};

const DETAIL_ROUTES: { path: string; permission: Permission; element: ReactNode }[] = [
  { path: "/companies/:companyId", permission: "company:read", element: <CompanyDetailPage /> },
  { path: "/job-requests/new", permission: "job:write", element: <JobRequestFormPage /> },
  { path: "/job-requests/:jobRequestId", permission: "job:read", element: <JobRequestDetailPage /> },
  { path: "/job-requests/:jobRequestId/edit", permission: "job:write", element: <JobRequestFormPage /> },
];

function SessionGate() {
  const { status, error, retrySession } = useAuth();

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
        {NAV_ITEMS.map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={<RequirePermission item={item}>{pages[item.path]}</RequirePermission>}
          />
        ))}
        {DETAIL_ROUTES.map(({ path, permission, element }) => (
          <Route key={path} path={path} element={<RequirePermission item={{ permission }}>{element}</RequirePermission>} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <SessionGate />
          </BrowserRouter>
        </AuthProvider>
        <Toaster position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
