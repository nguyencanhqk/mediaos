/**
 * S14-FND-MODULEMETA-1 / L1-RATCHET-RED — CỔNG chống drift `modules` (seed DB) ↔ `MODULE_APP_METADATA`
 * (hằng BE) ↔ `APP_REGISTRY` (hằng FE, packages/web-core).
 *
 * VÌ SAO CỔNG QUAN TRỌNG HƠN DỮ LIỆU: `getMyApps()` (module-catalog.service.ts:45-97) duyệt module ACTIVE
 * và **fail-soft** — thiếu metadata thì chỉ `logger.warn` + `continue`. Nghĩa là một wave sau bật
 * `modules.is_active=true` mà quên APPEND metadata sẽ KHÔNG có test nào đỏ, app card đơn giản là "biến
 * mất" trong im lặng. Ratchet này biến sự im lặng đó thành ĐỎ.
 *
 * BA CHIỀU (hàm thuần `auditModuleMetadataCoverage` ngay trong file này — KHÔNG tách file census sibling
 * vì nằm ngoài `paths` của WO):
 *   [1] MISSING_METADATA — mọi mã có hàng `modules` PHẢI có metadata, HOẶC nằm trong EXEMPT_MODULES kèm
 *       `reason` máy-đọc (không có reason ⇒ coi như KHÔNG miễn trừ).
 *   [2] ORPHAN_METADATA — chiều NGƯỢC: mọi key metadata PHẢI có hàng `modules`. Chặn "key CHẾT" kiểu 'LMS'
 *       (LMS là app riêng qua cầu SSO, KHÔNG có hàng `modules`) và typo.
 *   [3] DOUBLE_LISTED — mã đã EXEMPT thì KHÔNG được đồng thời có metadata (miễn trừ phải là tạm thời,
 *       không được để lửng lơ hai nơi).
 *
 * `seededCodes` PARSE THẬT từ `apps/api/migrations/*.sql` — ghim ĐỊNH NGHĨA (câu `INSERT INTO modules (…)
 * VALUES …`), KHÔNG hard-code mảng tên (memory: index-ratchet-must-pin-definition-not-name). Hard-code tên
 * thì thêm hàng `modules` ở migration mới sẽ KHÔNG làm cổng đỏ ⇒ cổng rỗng.
 *
 * TRẠNG THÁI KHI VIẾT (RED có chủ ý): 17 mã seed, `MODULE_APP_METADATA` có 8 key ⇒ 5 mã ĐỎ
 * MISSING_METADATA = GOAL · ASSET · ROOM · RECRUIT · PAYROLL (L2 sẽ APPEND 5 entry ⇒ GREEN).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULE_APP_METADATA,
  hasAnyCapability,
} from "../../src/foundation/module-catalog/module-app-metadata";

// tsconfig module=commonjs → dùng __dirname (như settings-seed4-defaults-drift.int-spec) thay vì import.meta.
// __dirname = apps/api/test/foundation → lùi 2 cấp tới apps/api, rồi vào migrations.
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PARSER — ghim ĐỊNH NGHĨA seed `modules`
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Chỉ khớp `INSERT INTO modules` — KHÔNG khớp `INSERT INTO system_modules` (mig 0330:48, bảng KHÁC của
 * module-registry cũ): `\s+` bắt buộc có khoảng trắng ngay trước `modules`, còn 'system_modules' có '_'.
 * Nhóm 1 = danh sách cột, nhóm 2 = thân VALUES (tới `;` đầu tiên — thân seed không chứa `;`).
 */
const INSERT_INTO_MODULES_RE = /INSERT\s+INTO\s+modules\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi;

/** Bỏ dòng comment SQL (`--`, kể cả `--> statement-breakpoint`) để comment không lọt vào tập parse. */
function stripSqlLineComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

/** Cắt các nhóm `( … )` ở ĐỘ SÂU 0 của thân VALUES, tôn trọng chuỗi `'…'` (escape `''`). */
function extractTuples(body: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "'") {
        if (body[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) start = i + 1;
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        tuples.push(body.slice(start, i));
        start = -1;
      }
    }
  }
  return tuples;
}

/** Tách giá trị top-level của 1 tuple theo dấu phẩy (bỏ qua phẩy trong chuỗi / ngoặc lồng). */
function splitTupleValues(tuple: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          cur += "'";
          i++;
        } else inStr = false;
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

export interface SeededModuleRow {
  code: string;
  file: string;
}

/**
 * Trả MỌI mã `module_code` được seed bởi câu `INSERT INTO modules (…) VALUES …` trong tập file SQL.
 * Vị trí cột `module_code` đọc TỪ danh sách cột (không giả định luôn là cột đầu).
 */
export function parseSeededModules(
  files: ReadonlyArray<{ file: string; sql: string }>,
): SeededModuleRow[] {
  const rows: SeededModuleRow[] = [];
  for (const { file, sql } of files) {
    const clean = stripSqlLineComments(sql);
    INSERT_INTO_MODULES_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INSERT_INTO_MODULES_RE.exec(clean)) !== null) {
      const cols = m[1].split(",").map((c) => c.trim().toLowerCase());
      const idx = cols.indexOf("module_code");
      if (idx < 0) continue; // câu INSERT không nêu module_code ⇒ không parse mù
      const body = m[2].split(/\bON\s+CONFLICT\b/i)[0];
      for (const tuple of extractTuples(body)) {
        const raw = splitTupleValues(tuple)[idx];
        if (!raw || !raw.startsWith("'")) continue;
        rows.push({ code: raw.slice(1, -1).replace(/''/g, "'"), file });
      }
    }
  }
  return rows;
}

function readMigrationSqlFiles(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HÀM THUẦN — audit 3 chiều
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type CoverageViolationKind = "MISSING_METADATA" | "ORPHAN_METADATA" | "DOUBLE_LISTED";

export interface CoverageViolation {
  kind: CoverageViolationKind;
  code: string;
  detail: string;
}

export interface CoverageInput {
  /** Mã có hàng `modules` (parse từ migration hoặc SELECT từ DB). */
  seededCodes: readonly string[];
  /** Key của MODULE_APP_METADATA. */
  metadataKeys: readonly string[];
  /** Mã được miễn trừ tạm thời → lý do máy-đọc. Lý do rỗng ⇒ KHÔNG tính là miễn trừ. */
  exempt: Readonly<Record<string, string>>;
}

export function auditModuleMetadataCoverage(input: CoverageInput): CoverageViolation[] {
  const seeded = new Set(input.seededCodes);
  const metadata = new Set(input.metadataKeys);
  const exemptWithReason = new Set(
    Object.entries(input.exempt)
      .filter(([, reason]) => typeof reason === "string" && reason.trim() !== "")
      .map(([code]) => code),
  );
  const violations: CoverageViolation[] = [];

  // [1] mọi mã seed phải có metadata HOẶC được miễn trừ kèm reason.
  for (const code of [...seeded].sort()) {
    if (metadata.has(code) || exemptWithReason.has(code)) continue;
    violations.push({
      kind: "MISSING_METADATA",
      code,
      detail: `Hàng 'modules' ${code} không có MODULE_APP_METADATA và không nằm trong EXEMPT_MODULES kèm reason`,
    });
  }

  // [2] chiều NGƯỢC — key metadata không có hàng `modules` = key CHẾT (vd 'LMS').
  for (const code of [...metadata].sort()) {
    if (seeded.has(code)) continue;
    violations.push({
      kind: "ORPHAN_METADATA",
      code,
      detail: `MODULE_APP_METADATA.${code} không có hàng 'modules' tương ứng (key chết / typo)`,
    });
  }

  // [3] miễn trừ và metadata loại trừ nhau.
  for (const code of Object.keys(input.exempt).sort()) {
    if (!metadata.has(code)) continue;
    violations.push({
      kind: "DOUBLE_LISTED",
      code,
      detail: `${code} vừa nằm EXEMPT_MODULES vừa có MODULE_APP_METADATA — chọn MỘT`,
    });
  }

  return violations;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HẰNG CỦA CỔNG
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * 4 mã Phase-sau seed `is_active=false` (mig 0435:299-302) và CHƯA có app-surface BE ⇒ miễn trừ CÓ LÝ DO.
 * Miễn trừ CHỈ hợp lệ khi module còn inactive — int-spec DB-backed
 * (`module-app-metadata-coverage.int.spec.ts`) KHÔNG chấp nhận miễn trừ cho module `is_active=true`.
 */
const EXEMPT_MODULES: Readonly<Record<string, string>> = {
  CHAT: "Phase 4 — mig 0435:299 is_active=false; app CHAT chạy ngoài my-apps (S7/S8 wave), chưa có card",
  SOCIAL: "Phase 4 — mig 0435:300 is_active=false; wave S16-SOCIAL sẽ bật cùng metadata",
  MOBILE: "Phase 5 — mig 0435:301 is_active=false; không có route web",
  AI: "Phase 5 — mig 0435:302 is_active=false; chưa có màn hình",
};

/**
 * Số hàng `modules` được seed bởi migration ở HEAD hiện tại:
 *   15 (mig 0435:287-302) + ME (0495:96) + GOAL (0506:36) = 17.
 * ⚠️ Con số này phải được bump CÓ CHỦ Ý khi thêm hàng `modules` — đi KÈM quyết định "module mới này có
 * metadata hay vào EXEMPT_MODULES". Bump máy móc cho xanh = phá cổng.
 */
const EXPECTED_SEEDED_MODULE_COUNT = 17;

/**
 * BLOCKING 3 — đối chiếu BẰNG CHỮ với `APP_REGISTRY` (packages/web-core/src/lib/registry.ts:660-847).
 * Viết LITERAL, KHÔNG import cross-package: apps/api KHÔNG phụ thuộc @mediaos/web-core, và đây chính là
 * điểm drift (hai hằng ở hai package, không có cổng runtime nào so chúng). Sai lệch ⇒ card mở nhầm chỗ.
 * Nguồn literal (đọc tay 02/09): goals :669/:671 · assets :776/:778 · rooms :797/:799 ·
 * recruit :818/:820 · payroll :841/:843.
 */
const APP_REGISTRY_LITERALS: Readonly<Record<string, { route: string; icon: string }>> = {
  GOAL: { route: "/goals", icon: "target" },
  ASSET: { route: "/assets", icon: "package" },
  ROOM: { route: "/rooms", icon: "calendar-clock" },
  RECRUIT: { route: "/recruit/job-openings", icon: "user-plus" },
  PAYROLL: { route: "/payroll/periods", icon: "wallet" },
};

/**
 * BLOCKING 1 — cặp ALLOW/DENY cho MỖI module mới, gọi THẲNG hàm thuần `hasAnyCapability`
 * (module-app-metadata.ts:121 — KHÔNG cần DB, KHÔNG qua Nest DI).
 *
 * `deny` = capability KHÔNG-wildcard mà một role CÓ THỂ có nhưng KHÔNG đủ để mở card (cặp `access:*` là
 * cổng nav chứ không phải cặp `requiredAny` đã chốt). Ca deny mà dùng wildcard thì xanh-rỗng.
 * `allow` = ĐÚNG cặp engine grep-verified trong seed migration.
 */
const NEW_MODULE_GATES: ReadonlyArray<{
  code: string;
  deny: Record<string, boolean>;
  allow: Record<string, boolean>;
}> = [
  // manager có 'access:recruit' (mig 0560:105) nhưng KHÔNG 'view:job-opening' (0560:81) ⇒ KHÔNG thấy card.
  { code: "RECRUIT", deny: { "access:recruit": true }, allow: { "view:job-opening": true } },
  // employee chỉ có 'access:payroll' @Own ⇒ KHÔNG thấy card; cặp thật = view:payroll-period (0565:189).
  { code: "PAYROLL", deny: { "access:payroll": true }, allow: { "view:payroll-period": true } },
  { code: "ASSET", deny: { "access:asset": true }, allow: { "view:asset": true } }, // 0550:61-101
  { code: "ROOM", deny: { "access:room": true }, allow: { "view:room": true } }, // 0554:57-91
  // GOAL: caps RỖNG ⇒ false. Ca này CHẾT nếu requiredAny của GOAL để rỗng (hasAnyCapability([]) === true)
  // ⇒ nó cũng là cổng chặn "GOAL hiện cho mọi user" kiểu ME.
  { code: "GOAL", deny: {}, allow: { "access:goal": true } }, // 0506:46
];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SPEC
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("S14-FND-MODULEMETA-1 — parser seed `modules` (ghim ĐỊNH NGHĨA, không hard-code tên)", () => {
  const seededRows = parseSeededModules(readMigrationSqlFiles());
  const seededCodes = [...new Set(seededRows.map((r) => r.code))].sort();

  it("parse ĐÚNG 17 mã từ apps/api/migrations/*.sql (15 @0435 + ME @0495 + GOAL @0506)", () => {
    expect(seededCodes.length).toBe(EXPECTED_SEEDED_MODULE_COUNT);
    expect(seededRows.length).toBe(EXPECTED_SEEDED_MODULE_COUNT); // không hàng nào trùng lặp
  });

  it("có mặt mã Phase-sau ('MOBILE', 'AI') và mã MVP — parser không bỏ sót tuple cuối", () => {
    for (const code of ["AUTH", "HR", "ATT", "LEAVE", "TASK", "DASH", "NOTI", "ME", "GOAL"]) {
      expect(seededCodes).toContain(code);
    }
    expect(seededCodes).toContain("MOBILE");
    expect(seededCodes).toContain("AI");
  });

  // CA ÂM — chứng minh parser không "quét bừa" mọi chuỗi trong migration.
  it("CA ÂM: KHÔNG nuốt key của bảng `system_modules` (mig 0330:48) và KHÔNG chứa 'LMS'", () => {
    // 0330 seed system_modules ('analytics', 'custom-workflows') — bảng KHÁC, KHÔNG phải catalog `modules`.
    expect(seededCodes).not.toContain("analytics");
    expect(seededCodes).not.toContain("custom-workflows");
    // LMS là app riêng mở qua cầu SSO — KHÔNG có hàng `modules` nào. Key metadata 'LMS' = key chết.
    expect(seededCodes).not.toContain("LMS");
  });

  it("mọi mã parse ra là identifier viết HOA (không lọt mảnh câu SQL)", () => {
    for (const code of seededCodes) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});

describe("S14-FND-MODULEMETA-1 — auditModuleMetadataCoverage (hàm thuần, self-check cổng)", () => {
  // Ca ALLOW BẮT BUỘC: không có nó thì mọi ca DENY dưới đây "xanh-RỖNG"
  // (memory: deny-cases-vacuous-without-allow-case).
  it("ALLOW: seeded [A,B] + metadata [A] + exempt {B: lý do} ⇒ 0 vi phạm", () => {
    const v = auditModuleMetadataCoverage({
      seededCodes: ["A", "B"],
      metadataKeys: ["A"],
      exempt: { B: "Phase sau — inactive" },
    });
    expect(v).toEqual([]);
  });

  it("DENY-1: mã seed không metadata, không miễn trừ ⇒ đúng 1 MISSING_METADATA", () => {
    const v = auditModuleMetadataCoverage({
      seededCodes: ["A", "B"],
      metadataKeys: ["A"],
      exempt: {},
    });
    expect(v.map((x) => [x.kind, x.code])).toEqual([["MISSING_METADATA", "B"]]);
  });

  it("DENY-1b: miễn trừ với reason RỖNG KHÔNG được tính là miễn trừ ⇒ 1 MISSING_METADATA", () => {
    const v = auditModuleMetadataCoverage({
      seededCodes: ["A", "B"],
      metadataKeys: ["A"],
      exempt: { B: "   " },
    });
    expect(v.map((x) => [x.kind, x.code])).toEqual([["MISSING_METADATA", "B"]]);
  });

  it("DENY-2: key metadata không có hàng `modules` ⇒ đúng 1 ORPHAN_METADATA (chặn key chết LMS)", () => {
    const v = auditModuleMetadataCoverage({
      seededCodes: ["A"],
      metadataKeys: ["A", "LMS"],
      exempt: {},
    });
    expect(v.map((x) => [x.kind, x.code])).toEqual([["ORPHAN_METADATA", "LMS"]]);
  });

  it("DENY-3: mã vừa EXEMPT vừa có metadata ⇒ đúng 1 DOUBLE_LISTED", () => {
    const v = auditModuleMetadataCoverage({
      seededCodes: ["A", "B"],
      metadataKeys: ["A", "B"],
      exempt: { B: "Phase sau — inactive" },
    });
    expect(v.map((x) => [x.kind, x.code])).toEqual([["DOUBLE_LISTED", "B"]]);
  });
});

describe("S14-FND-MODULEMETA-1 — RATCHET: seed `modules` ↔ MODULE_APP_METADATA", () => {
  const seededCodes = [...new Set(parseSeededModules(readMigrationSqlFiles()).map((r) => r.code))];
  const metadataKeys = Object.keys(MODULE_APP_METADATA);

  it("EXEMPT_MODULES chỉ chứa mã CÓ THẬT trong seed, kèm reason máy-đọc", () => {
    for (const [code, reason] of Object.entries(EXEMPT_MODULES)) {
      expect(seededCodes).toContain(code);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });

  it("[1] mọi mã `modules` có metadata HOẶC miễn trừ — RED liệt kê ĐÚNG mã thiếu", () => {
    const missing = auditModuleMetadataCoverage({
      seededCodes,
      metadataKeys,
      exempt: EXEMPT_MODULES,
    })
      .filter((v) => v.kind === "MISSING_METADATA")
      .map((v) => v.code);
    expect(missing).toEqual([]);
  });

  it("[2] chiều NGƯỢC: mọi key MODULE_APP_METADATA có hàng `modules` (chặn key chết 'LMS')", () => {
    const orphans = auditModuleMetadataCoverage({
      seededCodes,
      metadataKeys,
      exempt: EXEMPT_MODULES,
    })
      .filter((v) => v.kind === "ORPHAN_METADATA")
      .map((v) => v.code);
    expect(orphans).toEqual([]);
    expect(metadataKeys).not.toContain("LMS");
  });

  it("[3] không mã nào vừa EXEMPT vừa có metadata", () => {
    const doubles = auditModuleMetadataCoverage({
      seededCodes,
      metadataKeys,
      exempt: EXEMPT_MODULES,
    })
      .filter((v) => v.kind === "DOUBLE_LISTED")
      .map((v) => v.code);
    expect(doubles).toEqual([]);
  });

  it("8 key MVP + ME giữ NGUYÊN (no-regress route/icon)", () => {
    expect(MODULE_APP_METADATA.AUTH.route).toBe("/system");
    expect(MODULE_APP_METADATA.HR.route).toBe("/hr");
    expect(MODULE_APP_METADATA.ATT.route).toBe("/attendance");
    expect(MODULE_APP_METADATA.LEAVE.route).toBe("/leave");
    expect(MODULE_APP_METADATA.TASK.route).toBe("/tasks");
    expect(MODULE_APP_METADATA.DASH.route).toBe("/dashboard");
    expect(MODULE_APP_METADATA.NOTI.route).toBe("/notifications");
    expect(MODULE_APP_METADATA.ME.route).toBe("/me");
  });
});

describe("S14-FND-MODULEMETA-1 — BLOCKING 3: route+icon khớp LITERAL của APP_REGISTRY (FE)", () => {
  for (const [code, expected] of Object.entries(APP_REGISTRY_LITERALS)) {
    it(`${code}: route '${expected.route}' + icon '${expected.icon}' (đích ĐIỀU HƯỚNG, KHÔNG rootPath)`, () => {
      const meta = MODULE_APP_METADATA[code];
      expect(meta, `MODULE_APP_METADATA.${code} chưa tồn tại`).toBeDefined();
      expect(meta.route).toBe(expected.route);
      expect(meta.icon).toBe(expected.icon);
    });
  }
});

describe("S14-FND-MODULEMETA-1 — BLOCKING 1: deny-path THỰC THI qua hasAnyCapability", () => {
  for (const gate of NEW_MODULE_GATES) {
    it(`DENY ${gate.code}: caps KHÔNG-wildcard ${JSON.stringify(gate.deny)} ⇒ KHÔNG hiện card`, () => {
      const meta = MODULE_APP_METADATA[gate.code];
      expect(meta, `MODULE_APP_METADATA.${gate.code} chưa tồn tại`).toBeDefined();
      // Neo chống xanh-rỗng: caps của ca DENY tuyệt đối không được chứa wildcard.
      for (const key of Object.keys(gate.deny)) expect(key).not.toContain("*");
      expect(meta.requiredAny.length).toBeGreaterThan(0); // requiredAny rỗng ⇒ luôn true ⇒ ca DENY chết
      expect(hasAnyCapability(gate.deny, meta.requiredAny)).toBe(false);
    });

    it(`ALLOW ${gate.code}: cặp engine ${JSON.stringify(gate.allow)} ⇒ HIỆN card`, () => {
      const meta = MODULE_APP_METADATA[gate.code];
      expect(meta, `MODULE_APP_METADATA.${gate.code} chưa tồn tại`).toBeDefined();
      expect(hasAnyCapability(gate.allow, meta.requiredAny)).toBe(true);
    });
  }

  /**
   * GHI NHẬN (không phải mong muốn): deny KHÔNG tuyệt đối — PROD còn 2 role giữ grant wildcard '*:*'
   * ⇒ chúng thấy MỌI card bất kể requiredAny. `hasAnyCapability` khớp cả 4 hình dạng wildcard
   * ('a:r', '*:r', 'a:*', '*:*') (memory: permission-grant-census-must-cover-four-wildcard-shapes).
   * Ca này ĐÓNG ĐINH hành vi hiện tại để việc thu hồi wildcard sau này là thay đổi CÓ Ý THỨC.
   */
  it("GHI NHẬN wildcard: caps {'*:*': true} ⇒ true cho CẢ 5 module (deny KHÔNG tuyệt đối)", () => {
    for (const gate of NEW_MODULE_GATES) {
      const meta = MODULE_APP_METADATA[gate.code];
      expect(meta, `MODULE_APP_METADATA.${gate.code} chưa tồn tại`).toBeDefined();
      expect(hasAnyCapability({ "*:*": true }, meta.requiredAny)).toBe(true);
    }
  });

  it("mỗi module mới khai ĐÚNG 1 cặp engine và feCodes cùng độ dài", () => {
    for (const gate of NEW_MODULE_GATES) {
      const meta = MODULE_APP_METADATA[gate.code];
      expect(meta, `MODULE_APP_METADATA.${gate.code} chưa tồn tại`).toBeDefined();
      expect(meta.requiredAny.length).toBe(1);
      expect(meta.feCodes.length).toBe(meta.requiredAny.length);
      // Cặp legacy read:* KHÔNG tồn tại trong seed của 5 module này (drift-guard S1-FND-MODULE).
      for (const p of meta.requiredAny) expect(p.action).not.toBe("read");
      // KHÔNG dùng mã dotted FE làm cặp engine.
      for (const p of meta.requiredAny) expect(p.resourceType).not.toContain(".");
    }
  });
});
