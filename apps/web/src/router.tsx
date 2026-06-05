import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { LoginPage } from "@/routes/login";
import { RootLayout } from "@/routes/root-layout";
import { DepartmentsPage } from "@/routes/org/departments";
import { TeamsPage } from "@/routes/org/teams";
import { EmployeesPage } from "@/routes/org/employees";
import { ChannelsPage } from "@/routes/media/channels";
import { ProjectsPage } from "@/routes/media/projects";
import { ProjectDetailPage } from "@/routes/media/project-detail";
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  departmentsRoute,
  teamsRoute,
  employeesRoute,
  channelsRoute,
  projectsRoute,
  projectDetailRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
