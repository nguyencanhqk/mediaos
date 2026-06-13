import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { LoginPage } from "@/routes/login";
import { RootLayout } from "@/routes/root-layout";
import { DepartmentsPage } from "@/routes/org/departments";
import { TeamsPage } from "@/routes/org/teams";
import { EmployeesPage } from "@/routes/org/employees";
import { EmployeeDetailPage } from "@/routes/org/employees-detail";
import { PositionsPage } from "@/routes/org/positions";
import { CompanySettingsPage } from "@/routes/settings/company";
import { PlatformAccountsPage } from "@/routes/settings/platform-accounts";
import { ChannelsPage } from "@/routes/media/channels";
import { ChannelDetailPage } from "@/routes/media/channel-detail";
import { ProjectsPage } from "@/routes/media/projects";
import { ProjectDetailPage } from "@/routes/media/project-detail";
import { ContentPage } from "@/routes/media/content";
import { ContentDetailPage } from "@/routes/media/content-detail";
import { TasksPage } from "@/routes/tasks/index";
import { TaskBoardPage } from "@/routes/tasks/task-board";
import { TaskHubPage } from "@/routes/tasks/task-hub";
import { ProjectChatPage } from "@/routes/chat/project-chat";
import { WorkflowTemplatesPage } from "@/routes/workflows/templates";
import { WorkflowTemplateDetailPage } from "@/routes/workflows/template-detail";
import { WorkflowInstancesPage } from "@/routes/workflows/instances/instances-list";
import { WorkflowInstanceDetailPage } from "@/routes/workflows/instances/instance-detail";
import { DashboardPage } from "@/routes/dashboard/dashboard";
import { AttendancePage } from "@/routes/hr/attendance";
import { AdjustmentsPage } from "@/routes/hr/adjustments";
import { LeavePage } from "@/routes/hr/leave";
import { useAuthStore } from "@/stores/auth";

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: HomePage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) throw redirect({ to: "/login" });
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

const channelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/channels",
  beforeLoad: authGuard,
  component: ChannelsPage,
});

const channelDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/channels/$channelId",
  beforeLoad: authGuard,
  component: ChannelDetailPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  beforeLoad: authGuard,
  component: ProjectsPage,
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  beforeLoad: authGuard,
  component: ProjectDetailPage,
});

const contentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/content",
  beforeLoad: authGuard,
  component: ContentPage,
});

const contentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/content/$contentId",
  beforeLoad: authGuard,
  component: ContentDetailPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  beforeLoad: authGuard,
  component: TasksPage,
});

// G9-3: Task Board tổng (Kanban/Table/Calendar + filter task_type). Static path, không đụng /tasks.
const taskBoardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/board",
  beforeLoad: authGuard,
  component: TaskBoardPage,
});

// G9-4: Task Hub hợp nhất — My/Team/Project Tasks trên bảng tasks chung (BẤT BIẾN #4).
const taskHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/hub",
  beforeLoad: authGuard,
  component: TaskHubPage,
});

const projectChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/projects/$projectId",
  beforeLoad: authGuard,
  component: ProjectChatPage,
});

const positionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/positions",
  beforeLoad: authGuard,
  component: PositionsPage,
});

const workflowTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows/templates",
  beforeLoad: authGuard,
  component: WorkflowTemplatesPage,
});

const workflowTemplateDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows/templates/$templateId",
  beforeLoad: authGuard,
  component: WorkflowTemplateDetailPage,
});

const workflowInstancesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows/instances",
  beforeLoad: authGuard,
  component: WorkflowInstancesPage,
});

const workflowInstanceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows/instances/$instanceId",
  beforeLoad: authGuard,
  component: WorkflowInstanceDetailPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  beforeLoad: authGuard,
  component: DashboardPage,
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

const companySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/company",
  beforeLoad: authGuard,
  component: CompanySettingsPage,
});

const platformAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/platform-accounts",
  beforeLoad: authGuard,
  component: PlatformAccountsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  departmentsRoute,
  teamsRoute,
  employeesRoute,
  employeeDetailRoute,
  positionsRoute,
  companySettingsRoute,
  platformAccountsRoute,
  channelsRoute,
  channelDetailRoute,
  projectsRoute,
  projectDetailRoute,
  contentRoute,
  contentDetailRoute,
  tasksRoute,
  taskBoardRoute,
  taskHubRoute,
  projectChatRoute,
  workflowTemplatesRoute,
  workflowTemplateDetailRoute,
  workflowInstancesRoute,
  workflowInstanceDetailRoute,
  dashboardRoute,
  attendanceRoute,
  adjustmentsRoute,
  leaveRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
