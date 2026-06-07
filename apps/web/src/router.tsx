import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { LoginPage } from "@/routes/login";
import { RootLayout } from "@/routes/root-layout";
import { DepartmentsPage } from "@/routes/org/departments";
import { TeamsPage } from "@/routes/org/teams";
import { EmployeesPage } from "@/routes/org/employees";
import { PositionsPage } from "@/routes/org/positions";
import { CompanySettingsPage } from "@/routes/settings/company";
import { ChannelsPage } from "@/routes/media/channels";
import { ChannelDetailPage } from "@/routes/media/channel-detail";
import { ProjectsPage } from "@/routes/media/projects";
import { ProjectDetailPage } from "@/routes/media/project-detail";
import { ContentPage } from "@/routes/media/content";
import { ContentDetailPage } from "@/routes/media/content-detail";
import { TasksPage } from "@/routes/tasks/index";
import { ProjectChatPage } from "@/routes/chat/project-chat";
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

const companySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/company",
  beforeLoad: authGuard,
  component: CompanySettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  departmentsRoute,
  teamsRoute,
  employeesRoute,
  positionsRoute,
  companySettingsRoute,
  channelsRoute,
  channelDetailRoute,
  projectsRoute,
  projectDetailRoute,
  contentRoute,
  contentDetailRoute,
  tasksRoute,
  projectChatRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
