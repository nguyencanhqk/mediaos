import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { DepartmentsPage } from "@/routes/org/departments";
import { TeamsPage } from "@/routes/org/teams";
import { EmployeesPage } from "@/routes/org/employees";
import { EmployeeDetailPage } from "@/routes/org/employees-detail";
import { PositionsPage } from "@/routes/org/positions";
import { AttendancePage } from "@/routes/hr/attendance";
import { AdjustmentsPage } from "@/routes/hr/adjustments";
import { LeavePage } from "@/routes/hr/leave";
import { SalaryProfilesPage } from "@/routes/payroll/salary-profiles";
import { PayrollPeriodsPage } from "@/routes/payroll/periods";
import { PayslipsPage } from "@/routes/payroll/payslips";
import { BonusPenaltiesPage } from "@/routes/payroll/bonus-penalties";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";

const rootRoute = createRootRoute({ component: RootLayout });

// FS-1b: login đã externalize sang app đăng nhập trung tâm (apps/auth). Guard không còn route `/login` nội bộ
// → chưa đăng nhập thì `throw redirect({ href })` RA NGOÀI (TanStack tự suy `reloadDocument` cho absolute href:
// điều hướng cả trang về auth.<domain>?redirect=<đích> + DỪNG pipeline router). Boot (main.tsx) silent-refresh
// trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
  },
  component: HomePage,
});

const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
};

const departmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/departments",
  beforeLoad: authGuard,
  component: DepartmentsPage,
});

const teamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/teams",
  beforeLoad: authGuard,
  component: TeamsPage,
});

const employeesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/employees",
  beforeLoad: authGuard,
  component: EmployeesPage,
});

const employeeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/employees/$employeeId",
  beforeLoad: authGuard,
  component: EmployeeDetailPage,
});

const positionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/positions",
  beforeLoad: authGuard,
  component: PositionsPage,
});

const attendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/attendance",
  beforeLoad: authGuard,
  component: AttendancePage,
});

const adjustmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/adjustments",
  beforeLoad: authGuard,
  component: AdjustmentsPage,
});

const leaveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/leave",
  beforeLoad: authGuard,
  component: LeavePage,
});

const salaryProfilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/payroll/salary-profiles",
  beforeLoad: authGuard,
  component: SalaryProfilesPage,
});

// G12-FE: payroll periods (draft→approved→published FSM + SoD + re-auth payslip)
const payrollPeriodsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/payroll/periods",
  beforeLoad: authGuard,
  component: PayrollPeriodsPage,
});

// G12-FE: "Phiếu lương của tôi" (employee self-service) — money-free list + re-auth reveal + ack/dispute
const payslipsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/payroll/payslips",
  beforeLoad: authGuard,
  component: PayslipsPage,
});

// G12-FE: bonus/penalty manage + approve (self-approve UI block, server SoD authoritative)
const bonusPenaltiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/payroll/bonus-penalties",
  beforeLoad: authGuard,
  component: BonusPenaltiesPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  departmentsRoute,
  teamsRoute,
  employeesRoute,
  employeeDetailRoute,
  positionsRoute,
  attendanceRoute,
  adjustmentsRoute,
  leaveRoute,
  salaryProfilesRoute,
  payrollPeriodsRoute,
  payslipsRoute,
  bonusPenaltiesRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
