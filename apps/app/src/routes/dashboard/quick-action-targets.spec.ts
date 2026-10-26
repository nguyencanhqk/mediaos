/**
 * S20-DASH-QUICKACTION-1 — test TĨNH: mọi đích quick action mà API phát (DASH_QUICK_ACTION_TARGET_URLS,
 * @mediaos/contracts — cùng hằng mà `dashboard-widget-quick-actions.const.ts` dùng) phải mở đúng một màn
 * trong cây route THẬT của apps/app (singleton `router` của "@/router", gồm cả route khai qua registry).
 *
 * «Mở đúng» nghĩa là:
 * 1. Đường dẫn khớp một route KHÔNG tham số — không rơi vào route 404 (`*`) và không bị route tham số nuốt
 *    (lỗi cũ: `/tasks/new` khớp `/tasks/$taskId` với taskId «new» ⇒ «không tìm thấy việc»). Đích có
 *    `projectScoped` thì `${đích}/${id}` phải khớp route có đúng tham số đó.
 * 2. Mỗi tham số `?…` phải được `validateSearch` của route đích GIỮ nguyên giá trị. Route không khai
 *    `validateSearch` thì không màn nào đọc tham số ⇒ coi như bị bỏ.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DASH_QUICK_ACTION_PROJECT_SCOPED_CODES,
  DASH_QUICK_ACTION_TARGET_URLS,
  type DashQuickActionNavigateCode,
} from "@mediaos/contracts";
import { router } from "@/router";
import { LEGACY_QUICK_ACTION_TARGETS, resolveQuickActionTarget } from "./quick-action-targets";

type SearchValidator = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Danh sách lỗi của một đích; rỗng = mở đúng màn. */
function targetProblems(url: string, expectedParams: Record<string, string> = {}): string[] {
  const parsed = new URL(url, "http://app.invalid");
  const { foundRoute, routeParams } = router.getMatchedRoutes(parsed.pathname);
  if (!foundRoute) return [`${url}: không khớp route nào`];
  const problems: string[] = [];
  if (JSON.stringify(routeParams) !== JSON.stringify(expectedParams)) {
    problems.push(
      `${url}: khớp route «${foundRoute.fullPath}» với tham số ${JSON.stringify(routeParams)} ` +
        `(cần ${JSON.stringify(expectedParams)})`,
    );
  }
  const rawSearch = router.options.parseSearch(parsed.search) as Record<string, unknown>;
  const validate = foundRoute.options.validateSearch as SearchValidator | undefined;
  for (const [key, value] of Object.entries(rawSearch)) {
    if (typeof validate !== "function") {
      problems.push(
        `${url}: route «${foundRoute.fullPath}» không khai validateSearch ⇒ «${key}» bị bỏ`,
      );
      continue;
    }
    const kept = validate(rawSearch)[key];
    if (JSON.stringify(kept) !== JSON.stringify(value)) {
      problems.push(
        `${url}: validateSearch bỏ/đổi «${key}» (${JSON.stringify(value)} ⇒ ${String(kept)})`,
      );
    }
  }
  return problems;
}

const CODES = Object.keys(DASH_QUICK_ACTION_TARGET_URLS) as DashQuickActionNavigateCode[];

describe("S20-DASH-QUICKACTION-1 — đích quick action khớp cây route thật", () => {
  it.each(CODES)("%s: đích mở đúng một màn và giữ mọi tham số", (code) => {
    expect(targetProblems(DASH_QUICK_ACTION_TARGET_URLS[code])).toEqual([]);
  });

  it.each(DASH_QUICK_ACTION_PROJECT_SCOPED_CODES)(
    "%s (projectScoped): đích + /:projectId khớp route chi tiết dự án",
    (code) => {
      const projectId = randomUUID();
      expect(
        targetProblems(`${DASH_QUICK_ACTION_TARGET_URLS[code]}/${projectId}`, { projectId }),
      ).toEqual([]);
    },
  );

  // Đo: `navigate({ to })` KHÔNG tách `?…` — router dựng cả chuỗi thành pathname. Vì vậy link quick action
  // (NotificationTargetLink) điều hướng đích có query bằng `{ href }` (WidgetCard.attendance.spec.tsx).
  it("navigate({ to }) với đích có query dựng sai pathname ⇒ đích có query phải đi bằng href", () => {
    const url = DASH_QUICK_ACTION_TARGET_URLS.CREATE_TASK;
    expect(router.buildLocation({ to: url as "/" }).pathname).not.toBe(
      new URL(url, "http://app.invalid").pathname,
    );
  });

  it("bộ kiểm bắt được đích chết (404, bị route tham số nuốt, tham số bị bỏ)", () => {
    expect(targetProblems("/khong-co-man-nay")).not.toEqual([]);
    expect(targetProblems("/tasks/new")).not.toEqual([]);
    expect(targetProblems("/tasks/my-tasks?group=khong-co-nhom")).not.toEqual([]);
    expect(targetProblems("/leave/approvals?status=Pending")).not.toEqual([]);
  });
});

describe("S20-DASH-QUICKACTION-1 — payload widget CŨ (API chưa deploy) vẫn dẫn đúng chỗ", () => {
  it.each(Object.keys(LEGACY_QUICK_ACTION_TARGETS))("đích cũ %s ⇒ đích mới mở đúng màn", (old) => {
    const next = resolveQuickActionTarget(old);
    expect(next).not.toBe(old);
    expect(targetProblems(next ?? "")).toEqual([]);
  });

  it("đích cũ /projects/:id ⇒ /tasks/projects/:id", () => {
    const projectId = randomUUID();
    const next = resolveQuickActionTarget(`/projects/${projectId}`);
    expect(next).toBe(`${DASH_QUICK_ACTION_TARGET_URLS.OPEN_PROJECT}/${projectId}`);
    expect(targetProblems(next ?? "", { projectId })).toEqual([]);
  });

  it("đích mới và null đi nguyên", () => {
    for (const url of Object.values(DASH_QUICK_ACTION_TARGET_URLS)) {
      expect(resolveQuickActionTarget(url)).toBe(url);
    }
    expect(resolveQuickActionTarget(null)).toBeNull();
  });
});
