import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { CompanySettingsPage } from "@/routes/settings/company";
import { PlatformAccountsPage } from "@/routes/settings/platform-accounts";
import { BreakGlassPage } from "@/routes/settings/break-glass";
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
import { KpiPage } from "@/routes/kpi/index";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";

const rootRoute = createRootRoute({ component: RootLayout });

// FS-1b: login đã externalize sang app đăng nhập trung tâm (apps/auth). Guard không còn route `/login` nội bộ
// → chưa đăng nhập thì `throw redirect({ href })` RA NGOÀI (TanStack tự suy `reloadDocument` cho absolute href:
// điều hướng cả trang về auth.<domain>?redirect=<đích> + DỪNG pipeline router, KHÔNG nháy render route khi chưa
// auth). Boot (main.tsx) silent-refresh trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
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

// G8-4 FE: KPI / Mục tiêu — định nghĩa KPI + tính/cây mục tiêu (read/confirm:kpi gated)
const kpiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kpi",
  beforeLoad: authGuard,
  component: KpiPage,
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

// G6-2 PR-B ROUND 2: "My break-glass grants" — list + JIT reveal (active grants only, ephemeral plaintext).
const breakGlassRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/break-glass",
  beforeLoad: authGuard,
  component: BreakGlassPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  companySettingsRoute,
  platformAccountsRoute,
  breakGlassRoute,
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
  kpiRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
