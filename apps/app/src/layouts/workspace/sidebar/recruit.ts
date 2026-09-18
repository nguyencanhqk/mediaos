import { type SidebarItemMeta } from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// RECRUIT — Tuyển dụng (S12-RECRUIT-FE-1, SPEC-12 §9)
// ---------------------------------------------------------------------------
//
// Gate mục = gate ĐƯỜNG TẢI của chính màn đó (read-path-gate-pair-must-match-download-pair), cặp engine
// LITERAL đủ CẢ HAI access:recruit + view:<resource>. Mục «Pipeline ứng viên» gate bằng `view:candidate`
// — cặp SENSITIVE nhưng nằm trong SENSITIVE_CAPABILITY_ALLOWLIST của BE (permission.service.ts) nên
// /auth/me CÓ trả literal cho role được cấp (recruiter/hr/company-admin); wildcard *:* KHÔNG kế thừa ⇒
// role không được cấp thì mục biến mất (fail-closed, mirror semantics BE). Quyền GHI không gate ở đây.
export const RECRUIT_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "recruit.jobs",
    moduleCode: "RECRUIT",
    label: "Vị trí tuyển dụng",
    path: "/recruit/job-openings",
    icon: "briefcase",
    group: "overview",
    order: 10,
    requiredPermissions: ["access:recruit", "view:job-opening"],
  },
  {
    sidebarKey: "recruit.pipeline",
    moduleCode: "RECRUIT",
    label: "Pipeline ứng viên",
    path: "/recruit/pipeline",
    icon: "kanban-square",
    group: "overview",
    order: 20,
    requiredPermissions: ["access:recruit", "view:candidate"],
  },
  {
    sidebarKey: "recruit.interviews",
    moduleCode: "RECRUIT",
    label: "Lịch phỏng vấn",
    path: "/recruit/interviews",
    icon: "calendar-days",
    group: "overview",
    order: 30,
    requiredPermissions: ["access:recruit", "view:interview"],
  },
];
