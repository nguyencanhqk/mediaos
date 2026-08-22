import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blindSpots,
  pointKey,
  projectionPoints,
  rowScopePredicateMints,
  unscopedAuditConsumers,
} from "./identity-projection-census";
import {
  BASIS_CEILINGS,
  BLIND_SPOT_PINS,
  IDENTITY_VERDICTS,
  ROW_SCOPE_MINT_PINS,
  UNSCOPED_AUDIT_CONSUMER_PINS,
  type IdentityVerdict,
} from "./identity-projection-verdicts";

/**
 * S6-SEC-IDENTITY-PROJ-1 — RATCHET của tầng chiếu danh tính.
 *
 * Cơ chế của WO này gồm HAI lớp, thiếu một lớp là quay lại quy ước:
 *   • L1 (`src/permission/identity-projection.ts`) làm đường VÁ không thể viết sai — đi qua hàm chiếu
 *     thì bắt buộc có `IdentityGrant`, mà `IdentityGrant` chỉ dựng được bằng 4 constructor.
 *   • L2 (file này) làm đường NÉ không thể im lặng — một `.select({ email: users.email })` viết thẳng
 *     ở repository mới sẽ không chạm L1 lần nào, và đó chính là hình dạng của N-1c (KI-049).
 *
 * KHÔNG cần Postgres: đây là spec TĨNH (`*.unit-spec.ts`, glob đã khai ở `vitest.config.ts`). Nó chạy
 * ở MỌI lần `pnpm test`, kể cả khi không có `LANE_DB` — nên nó không rơi vào lớp "xanh vì SKIP".
 */

// tsconfig module=commonjs → `__dirname`, không `import.meta` (mẫu route-http-coverage.e2e-spec).
const SRC_ROOT = path.join(__dirname, "..", "..", "src");

function readSource(relFile: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relFile), "utf8");
}

/** Nhóm khoá theo file để in cặp diff khi rename. */
function byFile(keys: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const k of keys) {
    const file = k.slice(0, k.indexOf("#"));
    (m.get(file) ?? m.set(file, []).get(file)!).push(k);
  }
  return m;
}

/**
 * Thông điệp lỗi phải RẺ để sửa, nếu không ratchet sẽ bị gỡ ở WO sau thay vì được cập nhật.
 * Rename một hàm chiếu ⇒ khoá cũ mồ côi + khoá mới mồ côi TRONG CÙNG FILE ⇒ in cặp lại với nhau.
 */
function renameHint(missing: readonly string[], added: readonly string[]): string {
  const files = new Set([...byFile(missing).keys()].filter((f) => byFile(added).has(f)));
  if (files.size === 0) return "";
  const lines = [...files].map((f) => {
    const was = byFile(missing).get(f) ?? [];
    const now = byFile(added).get(f) ?? [];
    return `  ${f}\n${was.map((k) => `    - ${k}`).join("\n")}\n${now.map((k) => `    + ${k}`).join("\n")}`;
  });
  return (
    `\n\nCÓ THỂ LÀ RENAME (khoá mất và khoá mới nằm cùng file):\n${lines.join("\n")}\n` +
    "  → rename THUẦN: sửa phần `#fn` trong dòng verdict tương ứng.\n" +
    "  → đổi CÁCH CHIẾU (users.email ↔ getTableColumns ↔ alias): khoá đổi là ĐÚNG, phải ký lại qua FULL gate."
  );
}

describe("identity-projection ratchet (S6-SEC-IDENTITY-PROJ-1)", () => {
  const points = projectionPoints();
  const pointKeys = points.map(pointKey);
  const verdictByPoint = new Map<string, IdentityVerdict>(
    IDENTITY_VERDICTS.map((v) => [v.point, v]),
  );

  it("census tìm được điểm chiếu — bản thân scanner còn sống", () => {
    // Chốt chặn xanh-RỖNG: nếu scanner hỏng (đổi cây thư mục, đổi cách import schema) nó trả 0 điểm
    // và MỌI assert bên dưới sẽ xanh trong khi không đo gì cả.
    expect(points.length).toBeGreaterThan(50);
    expect(new Set(pointKeys).size).toBe(pointKeys.length);
  });

  it("chiều 1 — KHÔNG điểm mồ côi: mọi điểm chiếu phải có ĐÚNG một dòng phán quyết", () => {
    const orphans = pointKeys.filter((k) => !verdictByPoint.has(k));
    const removed = IDENTITY_VERDICTS.map((v) => v.point).filter((k) => !pointKeys.includes(k));
    expect(
      orphans,
      `${orphans.length} điểm chiếu danh tính KHÔNG có căn cứ trong identity-projection-verdicts.ts.\n` +
        "Mặc định của một điểm mới là VÁ (cho nó nhận IdentityGrant qua identityColumns), " +
        "KHÔNG phải xin một dòng waiver." +
        renameHint(removed, orphans),
    ).toEqual([]);
  });

  it("chiều 2 — KHÔNG verdict mồ côi: xoá code mà quên xoá sổ là ĐỎ", () => {
    // memory `review-gate-blind-to-deletions`: review gate mù với phần bị xoá. Sổ giữ một dòng cho
    // điểm không còn tồn tại nghĩa là lần review sau đọc một bản đồ sai.
    const stale = IDENTITY_VERDICTS.map((v) => v.point).filter((k) => !pointKeys.includes(k));
    expect(
      stale,
      `${stale.length} dòng phán quyết không khớp điểm nào trong cây code.` +
        renameHint(
          stale,
          pointKeys.filter((k) => !verdictByPoint.has(k)),
        ),
    ).toEqual([]);
  });

  it("chiều 3 — mỗi điểm ĐÚNG một dòng, và mọi dòng có lý do viết cho người", () => {
    const dupes = IDENTITY_VERDICTS.map((v) => v.point).filter((p, i, a) => a.indexOf(p) !== i);
    expect(dupes, "dòng phán quyết trùng khoá").toEqual([]);
    const thin = IDENTITY_VERDICTS.filter((v) => v.reason.trim().length < 40 || !v.signedBy.trim());
    expect(
      thin.map((v) => v.point),
      "lý do quá ngắn để người sau dùng được, hoặc thiếu chữ ký WO",
    ).toEqual([]);
  });

  it("chiều 4 — TRẦN ĐẾM cho bốn căn cứ không đo được bằng máy", () => {
    // MỌI basis có trần, không chỉ bốn cái "không đo được" (security-reviewer F5): sổ phán quyết chỉ
    // chứa CHUỖI, ratchet không bao giờ nhìn thấy vị từ SQL — nên `scoped-predicate` cũng chỉ là một
    // lời khai, y hệt `waiver`. Không trần thì đường né rẻ nhất là dán nhãn "đo được" lên điểm mới.
    const uncovered = [...new Set(IDENTITY_VERDICTS.map((v) => v.basis))].filter(
      (b) => !(b in BASIS_CEILINGS),
    );
    expect(uncovered, "basis đang dùng mà KHÔNG có trần đếm — đường né im lặng").toEqual([]);
    for (const [basis, ceiling] of Object.entries(BASIS_CEILINGS)) {
      const n = IDENTITY_VERDICTS.filter((v) => v.basis === basis).length;
      expect(
        n,
        `basis "${basis}" có ${n} dòng, trần là ${ceiling}. Vượt trần = nới một căn cứ KHÔNG kiểm được ` +
          "bằng máy ⇒ phải sửa BASIS_CEILINGS một cách có chủ đích và đi qua FULL gate.",
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it("chiều 5 — `identity-gated` phải có CƠ CHẾ thật trong file, không chỉ có nhãn", () => {
    // Đây là chiều DƯƠNG (bắt buộc phải có), KHÔNG phải một ngoại lệ miễn trừ: nó không cho ai dán
    // nhãn "đã bound bằng cặp danh bạ" lên một truy vấn chiếu thẳng. Nó KHÔNG chứng minh cột của
    // ĐIỂM ĐÓ đi qua cơ chế — đó là việc của int-spec deny/allow, và vì thế nhãn vẫn phải ký tay.
    const missing = IDENTITY_VERDICTS.filter((v) => v.basis === "identity-gated").filter((v) => {
      const src = readSource(v.point.slice(0, v.point.indexOf("#")));
      return !src.includes("identityColumns(") && !src.includes("identityInScope");
    });
    expect(
      missing.map((v) => v.point),
      'dòng ký basis "identity-gated" nhưng file không có cụm khử danh tính nào',
    ).toEqual([]);
  });

  it("chiều 6 — VÙNG MÙ đã pin: census tĩnh không nới rộng trong im lặng", () => {
    const blind = blindSpots();
    expect(
      blind.asIdentityGrant,
      "có lời ép kiểu sang IdentityGrant trong apps/api/src. Brand `unique symbol` chặn object literal " +
        "nhưng KHÔNG chặn ép kiểu — đây là đường duy nhất forge được một căn cứ giả, và nó phải bằng 0.",
    ).toBe(BLIND_SPOT_PINS.asIdentityGrant);
    expect(
      blind.bareSelect,
      "số `.select()` trần trên bảng `users` đã đổi. Mỗi cái là một chỗ scanner KHÔNG thấy tên cột nào " +
        "mà email/full_name vẫn ra response. Tăng ⇒ vùng mù rộng ra, phải nói ra và sửa pin.",
    ).toBeLessThanOrEqual(BLIND_SPOT_PINS.bareSelect);
    expect(
      blind.rawSqlIdentity,
      "số template `sql` ghép email/full_name bằng chuỗi thô đã tăng — ngoài tầm phân tích identifier.",
    ).toBeLessThanOrEqual(BLIND_SPOT_PINS.rawSqlIdentity);
    expect(
      blind.exportedUserAliases,
      "có thêm file EXPORT một `alias(users,…)`. Scanner lần alias trong MỘT file, nên một alias dùng " +
        "xuyên file là điểm chiếu VÔ HÌNH — đúng cách WO này suýt tự làm mù census khi nâng " +
        "`SECURITY_EVENT_ACTOR` lên cấp module.",
    ).toBeLessThanOrEqual(BLIND_SPOT_PINS.exportedUserAliases);
  });

  it("chiều 7 — ĐIỂM ĐÚC vị từ chặn TẬP HÀNG đúng bằng danh sách đã ký (S10-SEC-AUDITLOGROW-1)", () => {
    // `rowScopeSql()` gác đường TIÊU THỤ (assert basis + assert BẢNG). Nó KHÔNG gác đường ĐÚC: một
    // grant `scoped-predicate` đúc ở module mới rồi `and(grant.cond, …)` thẳng vào WHERE là hợp kiểu
    // và im lặng. Nên bề mặt đúc bị pin thành DANH SÁCH — không phải trần `<= n`, vì trần cho phép
    // đổi chỗ (gỡ một điểm, thêm một điểm khác) mà số không đổi.
    const mints = rowScopePredicateMints();

    // Chốt chặn xanh-RỖNG, cùng lý do với ca "census còn sống" ở trên: scanner hỏng ⇒ trả [] ⇒ phép
    // so bên dưới vẫn có thể xanh nếu ai đó cũng làm rỗng pin. Bắt buộc phải có ÍT NHẤT một điểm.
    expect(
      mints.length,
      "scanner điểm đúc trả rỗng — nó hỏng, không phải bề mặt biến mất",
    ).toBeGreaterThan(0);

    const signed: readonly string[] = ROW_SCOPE_MINT_PINS;
    const added = mints.filter((m) => !signed.includes(m));
    const removed = ROW_SCOPE_MINT_PINS.filter((m) => !mints.includes(m));
    expect(
      added,
      "điểm ĐÚC vị từ chặn TẬP HÀNG MỚI, chưa ký. Mỗi điểm mở một bề mặt bound-HÀNG mới ⇒ phải qua " +
        "FULL gate, ký vào ROW_SCOPE_MINT_PINS, và có int-spec deny/allow của CHÍNH bảng đó (assert " +
        "BẢNG trong rowScopeSql KHÔNG bắt được ca nơi-đúc-lẫn-nơi-tiêu-thụ cùng trỏ sai một bảng).",
    ).toEqual([]);
    expect(
      removed,
      "điểm đúc đã ký nhưng KHÔNG còn trong cây code — memory `review-gate-blind-to-deletions`: gỡ vị " +
        "từ chặn hàng là gỡ một lớp kiểm soát, phải nói ra chứ không để sổ giữ một bản đồ sai.",
    ).toEqual([]);
  });

  it("chiều 8 — hộ TIÊU THỤ họ `*UnscopedTx` của AuditRepository đúng bằng danh sách đã ký (S10-SEC-AUDITLOGROW-2)", () => {
    // Chiều 7 gác đường ĐÚC vị từ. Chiều NÀY gác đường TIÊU THỤ SAI — thứ chiều 7 không thấy.
    // Sau KI-072, `AuditRepository` có HAI họ: `*ForActorTx` (bound HÀNG) và `*UnscopedTx` (không
    // bound, hợp lệ đúng 3 hộ). Họ không-bound vẫn PUBLIC, nên một đường đọc COMPANY mới gọi nhầm nó
    // là hợp kiểu, XANH typecheck, và tái sinh KI-072 ở bề mặt thứ hai trong im lặng.
    const consumers = unscopedAuditConsumers();

    // Chốt chặn xanh-RỖNG (cùng khuôn chiều 7): scanner hỏng ⇒ [] ⇒ phép so vẫn xanh nếu pin cũng rỗng.
    expect(
      consumers.length,
      "scanner hộ tiêu thụ trả rỗng — nó hỏng, không phải bề mặt biến mất (họ `*UnscopedTx` ít nhất " +
        "phải xuất hiện ở chính nơi định nghĩa)",
    ).toBeGreaterThan(0);

    const signed: readonly string[] = UNSCOPED_AUDIT_CONSUMER_PINS;
    expect(
      consumers.filter((c) => !signed.includes(c)),
      "hộ TIÊU THỤ MỚI của đường đọc `audit_logs` KHÔNG bound HÀNG. Nếu đây là một đường đọc COMPANY " +
        "(có actor HTTP) thì nó PHẢI dùng họ `*ForActorTx` — đó chính là KI-072. Nếu nó thật sự thuộc " +
        "một trong ba lý do hợp lệ (operator chéo tenant / module viewer có cặp quyền riêng + allowlist " +
        "objectTypes), hãy ký vào UNSCOPED_AUDIT_CONSUMER_PINS kèm lý do, qua FULL gate.",
    ).toEqual([]);
    expect(
      UNSCOPED_AUDIT_CONSUMER_PINS.filter((c) => !consumers.includes(c)),
      "hộ đã ký nhưng KHÔNG còn chạm họ `*UnscopedTx` — hoặc nó đã được bound (tin tốt: cập nhật sổ), " +
        "hoặc file đã đổi tên/biến mất. Cả hai đều phải nói ra (`review-gate-blind-to-deletions`).",
    ).toEqual([]);
  });
});
