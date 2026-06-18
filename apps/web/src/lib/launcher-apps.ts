import { Briefcase, FolderKanban, Settings, Users, type LucideIcon } from "lucide-react";

/**
 * Registry các product app cho LAUNCHER root-domain (FS-5 cutover).
 *
 * apps/web không còn route nghiệp vụ — Wave 2 đã tách work/process/goals→studio, hr/attendance/payroll→people,
 * system→console (mỗi app là 1 SPA trên SUBDOMAIN riêng). Launcher chỉ là bệ phóng: liệt kê 3 app, link TUYỆT
 * ĐỐI cross-origin (reloadDocument vì khác origin), gate theo capability của user (SSO: cùng phiên, đổi app
 * không đăng nhập lại nhờ cookie `Domain=.<domain>`).
 *
 * URL lấy từ build env (`VITE_{STUDIO,PEOPLE,CONSOLE}_URL`) — default dev `*.localhost:<port>` để cookie
 * `Domain=.localhost` chạy giống prod. Prod đặt `https://studio.<domain>` … (xem .env.example + runbook FS-5).
 */
export interface LauncherApp {
  /** Định danh ổn định. */
  id: string;
  /** i18n key (namespace "home", tiền tố "apps."). */
  nameKey: string;
  descKey: string;
  /** URL tuyệt đối tới SPA của app (subdomain riêng). */
  url: string;
  icon: LucideIcon;
  /** Class màu ô icon. */
  tile: string;
  /**
   * Capability đại diện cho app (`action:resourceType`). Tile chỉ hiện nếu user có BẤT KỲ key nào
   * (resolution wildcard giống useCan → admin `*:*` thấy hết). Rỗng = luôn hiện. Liệt kê nhiều key
   * để không ẩn nhầm app người dùng có quyền vào (đích vẫn tự enforce permission ở route của nó).
   */
  anyOf: readonly string[];
}

/** Default dev: mỗi app phục vụ trên origin `*.localhost:<port>` riêng (khớp vite.config từng app). */
const DEV_URL = {
  studio: "http://studio.localhost:5276",
  people: "http://people.localhost:5277",
  console: "http://console.localhost:5278",
  projects: "http://projects.localhost:5279",
} as const;

export const LAUNCHER_APPS: readonly LauncherApp[] = [
  {
    id: "studio",
    nameKey: "apps.studio.name",
    descKey: "apps.studio.desc",
    url: import.meta.env.VITE_STUDIO_URL ?? DEV_URL.studio,
    icon: Briefcase,
    tile: "bg-blue-50 text-blue-600",
    anyOf: [
      "read:task",
      "read:channel",
      "read:content",
      "read:project",
      "read:workflow_template",
      "read:dashboard",
      "read:kpi",
    ],
  },
  {
    id: "projects",
    nameKey: "apps.projects.name",
    descKey: "apps.projects.desc",
    url: import.meta.env.VITE_PROJECTS_URL ?? DEV_URL.projects,
    icon: FolderKanban,
    tile: "bg-violet-50 text-violet-600",
    anyOf: ["read:project", "read:task"],
  },
  {
    id: "people",
    nameKey: "apps.people.name",
    descKey: "apps.people.desc",
    url: import.meta.env.VITE_PEOPLE_URL ?? DEV_URL.people,
    icon: Users,
    tile: "bg-emerald-50 text-emerald-600",
    anyOf: [
      "read:employee",
      "read:attendance",
      "read:leave",
      "read:salary_profile",
      "read:payroll_period",
      "read:org_unit",
    ],
  },
  {
    id: "console",
    nameKey: "apps.console.name",
    descKey: "apps.console.desc",
    url: import.meta.env.VITE_CONSOLE_URL ?? DEV_URL.console,
    icon: Settings,
    tile: "bg-violet-50 text-violet-600",
    anyOf: [
      "manage:company",
      "read:company",
      "create:platform-account",
      "edit-platform-account:platform-account",
      "reveal-secret:platform-account",
    ],
  },
];

/**
 * Kiểm tra user có BẤT KỲ capability nào trong `anyOf` không — mirror đúng thứ tự wildcard của
 * `useCan` (exact → *:resource → action:* → *:*). Đọc thẳng map `capabilities` (không gọi hook trong
 * vòng lặp → an toàn rules-of-hooks). `anyOf` rỗng = luôn cho phép.
 */
export function hasAnyCapability(
  capabilities: Record<string, boolean>,
  anyOf: readonly string[],
): boolean {
  if (anyOf.length === 0) return true;
  return anyOf.some((key) => {
    const sep = key.indexOf(":");
    const action = key.slice(0, sep);
    const resourceType = key.slice(sep + 1);
    return (
      capabilities[`${action}:${resourceType}`] ??
      capabilities[`*:${resourceType}`] ??
      capabilities[`${action}:*`] ??
      capabilities["*:*"] ??
      false
    );
  });
}
