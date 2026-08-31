/**
 * S12-RECRUIT-FE-1 — neo phần WIRING của module RECRUIT (registry · route · sidebar · gate), khuôn
 * `asset-wiring.spec.ts`. Ba nhóm ca:
 *
 *  1. **Pair-drift** — `RECRUIT_ENGINE_PAIRS` (constants.ts) phải khớp TỪNG TRƯỜNG với
 *     `apps/api/src/recruit/recruit-route-pairs.const.ts` (đọc bằng `fs`, KHÔNG import chéo package —
 *     `apps/app` không import được `apps/api`). So theo CẶP, không theo bảng chép tay riêng.
 *  2. **Gate màn ≠ gate đường tải** — mọi lối vào RECRUIT phải đòi ĐỦ `access:recruit` + `view:<resource>`
 *     đúng với route đó đang tải (`read-path-gate-pair-must-match-download-pair`).
 *  3. **Thứ tự route tĩnh/động** — `/recruit/candidates/new` PHẢI đứng TRƯỚC
 *     `/recruit/candidates/$candidateId` (bẫy `/goals/new`).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROUTE_REGISTRY, APP_REGISTRY, type RouteMeta } from "@mediaos/web-core";
import { RECRUIT_SIDEBAR, SIDEBAR_REGISTRY } from "@/layouts/workspace/sidebar-registry";
import { RECRUIT_ENGINE_PAIRS } from "./constants";

const repoRoot = path.resolve(__dirname, "../../../../..");

describe("RECRUIT wiring — pair-drift (RECRUIT_ENGINE_PAIRS vs recruit-route-pairs.const.ts)", () => {
  const beSrc = fs.readFileSync(
    path.join(repoRoot, "apps/api/src/recruit/recruit-route-pairs.const.ts"),
    "utf8",
  );

  /** `key: pair("action", "resourceType"[, isSensitive[, companyFloor]]),` — đọc TỪ FILE BE thật. */
  const ENTRY_RE = /(\w+):\s*pair\(\s*"([^"]+)",\s*"([^"]+)"(?:,\s*(true|false))?/g;
  const beEntries = new Map<
    string,
    { action: string; resourceType: string; isSensitive: boolean }
  >();
  for (const m of beSrc.matchAll(ENTRY_RE)) {
    const [, key, action, resourceType, isSensitive] = m;
    beEntries.set(key, { action, resourceType, isSensitive: isSensitive === "true" });
  }

  it("đọc được đủ 32 route pair từ file BE (regex census không mù)", () => {
    expect(beEntries.size).toBe(32);
  });

  it("mỗi khoá RECRUIT_ENGINE_PAIRS khớp ĐÚNG action/resourceType/isSensitive của BE", () => {
    for (const [key, feEntry] of Object.entries(RECRUIT_ENGINE_PAIRS)) {
      const beEntry = beEntries.get(key);
      expect(beEntry, `BE không có khoá ${key}`).toBeTruthy();
      expect(feEntry.action, `action lệch ở ${key}`).toBe(beEntry?.action);
      expect(feEntry.resourceType, `resourceType lệch ở ${key}`).toBe(beEntry?.resourceType);
      expect(feEntry.isSensitive, `isSensitive lệch ở ${key}`).toBe(beEntry?.isSensitive);
    }
  });

  it("không thiếu/thừa khoá nào so với BE (32 = 32)", () => {
    expect(Object.keys(RECRUIT_ENGINE_PAIRS).sort()).toEqual([...beEntries.keys()].sort());
  });

  it("13 route resource candidate ĐỀU sensitive (0560) — không route candidate nào lọt lưới", () => {
    const candidateKeys = Object.entries(RECRUIT_ENGINE_PAIRS)
      .filter(([, p]) => p.resourceType === "candidate")
      .map(([k]) => k)
      .sort();
    expect(candidateKeys).toEqual(
      [
        "candidateCheckDuplicate",
        "candidateConvert",
        "candidateCreate",
        "candidateDetail",
        "candidateExport",
        "candidateList",
        "candidateMoveStage",
        "candidateNoteCreate",
        "candidateNoteUpdate",
        "candidateNotesList",
        "candidateStageEvents",
        "candidateSummary",
        "candidateUpdate",
      ].sort(),
    );
    for (const key of candidateKeys) {
      expect(RECRUIT_ENGINE_PAIRS[key as keyof typeof RECRUIT_ENGINE_PAIRS].isSensitive, key).toBe(
        true,
      );
    }
  });

  it("7 cặp (action,candidate) DUY NHẤT là sensitive: view/create/update/move-stage/comment/export/convert", () => {
    const distinctPairs = new Set(
      Object.values(RECRUIT_ENGINE_PAIRS)
        .filter((p) => p.resourceType === "candidate")
        .map((p) => p.action),
    );
    expect([...distinctPairs].sort()).toEqual(
      ["comment", "convert", "create", "export", "move-stage", "update", "view"].sort(),
    );
  });

  it("không resource nào KHÁC candidate bị đánh sensitive (job-opening/interview/offer đều false)", () => {
    for (const [key, p] of Object.entries(RECRUIT_ENGINE_PAIRS)) {
      if (p.resourceType === "candidate") continue;
      expect(p.isSensitive, `${key} không nên sensitive`).toBe(false);
    }
  });
});

describe("RECRUIT wiring — gate lối vào đòi ĐỦ CẢ HAI cặp (access:recruit + view:<resource>)", () => {
  // 3 màn sidebar đăng ký ở ROUTE_REGISTRY (web-core). Chi tiết/form ứng viên KHÔNG ở đây — chúng dùng
  // RouteMeta CỤC BỘ khai trực tiếp trong router.tsx (mẫu ASSET detail/new/edit), kiểm ở block riêng
  // bên dưới bằng cách đọc SOURCE (fs), không tra ROUTE_REGISTRY (tra nhầm ⇒ "thiếu route meta" giả).
  const entries: readonly [string, string][] = [
    ["recruit.jobs", "view:job-opening"],
    ["recruit.pipeline", "view:candidate"],
    ["recruit.interviews", "view:interview"],
  ];

  it.each(entries)("ROUTE_REGISTRY '%s' đòi access:recruit + %s", (routeKey, viewPair) => {
    const meta = ROUTE_REGISTRY.find((r: RouteMeta) => r.routeKey === routeKey);
    expect(meta, `thiếu route meta ${routeKey}`).toBeTruthy();
    expect(meta?.requiredPermissions).toEqual(["access:recruit", viewPair]);
    expect(meta?.requiredAnyPermissions).toBeUndefined();
  });

  it("thẻ App Switcher 'recruit' đòi access:recruit + view:job-opening", () => {
    const app = APP_REGISTRY.find((a) => a.appKey === "recruit");
    expect(app, "thiếu APP_REGISTRY 'recruit'").toBeTruthy();
    expect(app?.moduleCode).toBe("RECRUIT");
    expect(app?.requiredPermissions).toEqual(["access:recruit", "view:job-opening"]);
    expect(app?.requiredAnyPermissions).toBeUndefined();
  });

  it("mọi mục RECRUIT_SIDEBAR đòi ĐỦ CẢ HAI, đúng cặp view của trang nó trỏ tới", () => {
    expect(RECRUIT_SIDEBAR.length).toBeGreaterThan(0);
    const expectByKey: Record<string, string> = {
      "recruit.jobs": "view:job-opening",
      "recruit.pipeline": "view:candidate",
      "recruit.interviews": "view:interview",
    };
    for (const item of RECRUIT_SIDEBAR) {
      const want = expectByKey[item.sidebarKey];
      expect(want, `mục lạ chưa khai trong test: ${item.sidebarKey}`).toBeTruthy();
      expect(item.requiredPermissions, `mục ${item.sidebarKey}`).toEqual(["access:recruit", want]);
      expect(item.requiredAnyPermissions).toBeUndefined();
    }
  });

  it("SIDEBAR_REGISTRY có khoá RECRUIT (thiếu ⇒ workspace không render mục nào)", () => {
    expect(SIDEBAR_REGISTRY.RECRUIT).toBe(RECRUIT_SIDEBAR);
  });

  it.each(["recruitCandidateNewMeta", "recruitCandidateDetailMeta", "recruitCandidateEditMeta"])(
    "RouteMeta CỤC BỘ '%s' (router.tsx) đòi access:recruit + view:candidate",
    (metaName) => {
      const routerSrc = fs.readFileSync(path.resolve(__dirname, "../../router.tsx"), "utf8");
      const start = routerSrc.indexOf(`const ${metaName}: RouteMeta = {`);
      expect(start, `thiếu khai báo ${metaName}`).toBeGreaterThan(-1);
      const block = routerSrc.slice(start, routerSrc.indexOf("};", start));
      expect(block).toContain('requiredPermissions: ["access:recruit", "view:candidate"]');
    },
  );
});

describe("RECRUIT wiring — router: tĩnh TRƯỚC động", () => {
  const routerSrc = fs.readFileSync(path.resolve(__dirname, "../../router.tsx"), "utf8");

  const treeIndex = (name: string) => {
    const tree = routerSrc.slice(routerSrc.indexOf("rootRoute.addChildren(["));
    const i = tree.indexOf(`  ${name},`);
    expect(i, `route '${name}' chưa được lắp vào cây`).toBeGreaterThan(-1);
    return i;
  };

  it("recruitCandidateNewRoute đứng TRƯỚC recruitCandidateDetailRoute", () => {
    expect(treeIndex("recruitCandidateNewRoute")).toBeLessThan(
      treeIndex("recruitCandidateDetailRoute"),
    );
  });

  it("recruitCandidateDetailRoute đứng TRƯỚC recruitCandidateEditRoute (thứ tự khai — không xung đột path)", () => {
    // /recruit/candidates/$candidateId/edit không khớp /recruit/candidates/$candidateId nên không bắt
    // buộc thứ tự — ca này chỉ ghim cả 3 route CÙNG có mặt, tránh xoá nhầm lúc dọn file.
    expect(treeIndex("recruitCandidateDetailRoute")).toBeGreaterThan(-1);
    expect(treeIndex("recruitCandidateEditRoute")).toBeGreaterThan(-1);
  });

  it("cả 6 route RECRUIT đều đã lắp vào cây", () => {
    for (const r of [
      "recruitJobsRoute",
      "recruitPipelineRoute",
      "recruitInterviewsRoute",
      "recruitCandidateNewRoute",
      "recruitCandidateDetailRoute",
      "recruitCandidateEditRoute",
    ]) {
      expect(treeIndex(r)).toBeGreaterThan(-1);
    }
  });
});

describe("RECRUIT wiring — migration bật module đi CÙNG commit với lần gỡ pin", () => {
  it("migration 0562 tồn tại và có trong _journal.json", () => {
    const tag = "0562_s12recruitfe1_enable_recruit_module";
    const sql = path.join(repoRoot, "apps/api/migrations", `${tag}.sql`);
    expect(fs.existsSync(sql), `thiếu ${tag}.sql`).toBe(true);
    const journal = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "apps/api/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    expect(
      journal.entries.some((e) => e.tag === tag),
      `${tag} chưa vào journal`,
    ).toBe(true);
  });

  it("pin smoke KHÔNG còn liệt RECRUIT là inactive, VÀ đã assert RECRUIT active", () => {
    const smoke = fs.readFileSync(
      path.join(repoRoot, "apps/api/test/integration/migration-smoke.int-spec.ts"),
      "utf8",
    );
    // ĐỌC TRỌN KHỐI (multiline tới dòng chứa "] as const"), KHÔNG chỉ dòng ĐẦU — bản trước đọc một dòng
    // duy nhất bằng `.find((l) => l.startsWith(...))`; Prettier bọc mảng dài xuống nhiều dòng thì dòng
    // đầu chỉ còn `const EXTENSION_INACTIVE_MODULES = [` — check `.not.toContain('"RECRUIT"')` PASS
    // XANH-RỖNG vì "RECRUIT" nằm ở dòng kế tiếp mà test không hề đọc tới (memory
    // `vitest-exclude-selfcheck-reads-comments`, cùng lớp lỗi đọc-thiếu).
    const extractBlock = (constName: string): string => {
      const start = smoke.indexOf(`const ${constName}`);
      expect(start, `không tìm thấy khai báo ${constName}`).toBeGreaterThan(-1);
      const end = smoke.indexOf("as const", start);
      expect(end, `khối ${constName} không kết thúc bằng "as const"`).toBeGreaterThan(start);
      return smoke.slice(start, end);
    };

    const inactiveBlock = extractBlock("EXTENSION_INACTIVE_MODULES");
    expect(inactiveBlock).not.toContain('"RECRUIT"');

    const activeBlock = extractBlock("EXTENSION_ACTIVE_MODULES");
    expect(
      activeBlock,
      "EXTENSION_ACTIVE_MODULES thiếu RECRUIT (chưa assert dương tính is_active)",
    ).toContain('"RECRUIT"');
  });
});
