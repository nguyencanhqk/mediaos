import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectFkPairs,
  collectRlsTablesWithoutCompanyId,
  countTenantDrift,
  pairKey,
  suggestedFix,
  type FkPair,
} from "../foundation/fk-tenant-census";
import {
  FK_SINGLE_COL_PAIRS_FLOOR,
  FK_TENANT_WAIVERS,
  PARTIAL_ENFORCEMENT_PAIRS,
  RLS_TABLES_WITHOUT_COMPANY_ID,
} from "../foundation/fk-tenant-verdicts";
import { directPool, hasDb } from "../helpers/integration-db";

/**
 * S6-SEC-XTENANTFK-1 (KI-046) — CHỐT CHỐNG MỌC THÊM cho lớp lỗ "FK một-cột nối hai bảng tenant".
 *
 * VÌ SAO CẦN CHỐT chứ không chỉ cần bản vá. Đây là **lớp lỗ**, không phải bug lẻ: mỗi bảng nghiệp vụ
 * mới thêm một `.references()` là mở lại đúng lỗ đó. `0533` vá 1 endpoint rồi 457 cặp cùng hình dạng
 * vẫn nằm nguyên — chính vì lần trước không có chốt. Cùng lớp lỗi với KI-036/KI-028.
 *
 * TEST NÀY ĐỎ KHI: thêm bảng/FK một-cột mới giữa hai bảng tenant mà quên composite FK · gỡ một
 * composite FK đã có · dữ liệu lệch tenant xuất hiện · waiver mồ côi (cặp đã hết tồn tại).
 *
 * NƠI CHẠY: `hasDb = Boolean(DATABASE_DIRECT_URL && DATABASE_URL)` — **KHÔNG** gate theo `LANE_DB`.
 * Cả `.github/workflows/api.yml:83-84` lẫn `ci.yml:47-48` set hai biến này ở cấp job ⇒ spec này
 * chạy THẬT trên CI, là chốt cơ học chứ không phải nghi thức. Local thiếu DB thì skip (không đỏ giả);
 * chạy như CI bằng `bash harness/check.sh --lane-db`.
 */
describe.skipIf(!hasDb)("S6-SEC-XTENANTFK-1 · chốt FK chéo tenant", () => {
  const direct = directPool();
  let pairs: FkPair[] = [];

  afterAll(async () => {
    await direct.end();
  });

  async function census(): Promise<FkPair[]> {
    if (pairs.length === 0) pairs = await collectFkPairs(direct);
    return pairs;
  }

  it("PIN: census KHÔNG được co về rỗng (chống false-green do bộ lọc sai)", async () => {
    const all = await census();
    expect(
      all.length,
      `Census chỉ thấy ${all.length} cặp FK một-cột giữa hai bảng tenant (sàn ${FK_SINGLE_COL_PAIRS_FLOOR}). ` +
        `Một truy vấn catalog trả về gần-rỗng thì MỌI assert dưới đây xanh mà không chứng minh gì. ` +
        `Nếu là chủ đích (gỡ bảng), hạ sàn kèm lý do trong commit.`,
    ).toBeGreaterThanOrEqual(FK_SINGLE_COL_PAIRS_FLOOR);
  });

  it("(a) KHÔNG cặp lớp T nào còn hở — mọi FK tới bảng tenant thuần phải có composite FK", async () => {
    const open = (await census()).filter((p) => p.targetTenantOnly && !p.covered);
    const detail = open
      .map((p) => `  • ${pairKey(p)}  (${p.constraintName})\n${suggestedFix(p)}`)
      .join("\n");
    expect(
      open.map(pairKey),
      `${open.length} khoá ngoại MỘT-CỘT nối hai bảng tenant chưa có composite FK. Kiểm tra FK của ` +
        `Postgres BỎ QUA RLS ⇒ trong ngữ cảnh tenant A ghi được hàng của mình trỏ sang bản ghi của B ` +
        `(KI-046). Vá bằng migration mới:\n${detail}`,
    ).toEqual([]);
  });

  it("(b) mọi cặp CÒN HỞ phải có phán quyết ĐÃ KÝ trong fk-tenant-verdicts.ts", async () => {
    const signed = new Set(FK_TENANT_WAIVERS.map((w) => w.pair));
    const unsigned = (await census()).filter((p) => !p.covered && !signed.has(pairKey(p)));
    expect(
      unsigned.map(pairKey),
      `Cặp còn hở mà KHÔNG có chữ ký. Nếu bảng đích là catalog toàn cục (company_id NULLABLE, có ` +
        `hàng dùng chung) thì thêm waiver kèm lý do; nếu không thì VÁ, đừng ký.`,
    ).toEqual([]);
  });

  /**
   * (c) 0 hàng đang lệch tenant — **OPT-IN, KHÔNG chạy trong suite mặc định**.
   *
   * VÌ SAO KHÔNG chạy mặc định (đo được 2026-07-31, không phải phòng xa): assert này đọc TOÀN BỘ DB
   * tại một thời điểm, trong khi các spec chạy SONG SONG trên cùng lane DB **cố ý gieo hàng lệch
   * tenant** qua `seedCrossTenantViolation` để kiểm tuyến phòng thủ thứ hai. Chạy chung, nó bắt được
   * đúng những hàng đó và ĐỎ — rồi xanh lại sau khi các spec kia dọn. Đó là đỏ-giả phụ thuộc thời
   * điểm, thứ dự án này đã trả giá nhiều lần (memory `fullsuite-enobufs-and-unrescued-chunk`).
   *
   * KHẢ NĂNG KHÔNG MẤT — nó chỉ chuyển về đúng chỗ:
   *   • đường DEPLOY: bước (0) của mig `0535` tự đếm và `RAISE EXCEPTION` trước khi thêm constraint;
   *   • đường VẬN HÀNH: chạy tay trên DB thật trước/sau deploy bằng
   *     `FK_DRIFT_ASSERT=1 LANE_DB=<db> pnpm --filter @mediaos/api exec vitest run test/integration/xtenant-fk-ratchet.int-spec.ts`
   *
   * Sau `0535`, hàng lệch mới KHÔNG vào được nữa (đó là bản vá), nên giá trị của assert này là để
   * soi DB CŨ / sau restore — đúng thời điểm người ta chủ động chạy nó.
   */
  it.skipIf(process.env.FK_DRIFT_ASSERT !== "1")(
    "(c) 0 hàng đang lệch tenant — opt-in FK_DRIFT_ASSERT=1 (đo lại, không tin số cũ)",
    async () => {
      const drift = await countTenantDrift(direct, await census());
      expect(
        drift.map((d) => `${pairKey(d.pair)} = ${d.rows} hàng`),
        `Có hàng nghiệp vụ đang trỏ sang bản ghi của tenant KHÁC. Đây là dữ liệu lệch THẬT (đã loại ` +
          `hàng NULL đúng ngữ nghĩa MATCH SIMPLE) — phải có người quyết xoá hay sửa, KHÔNG tự dọn ` +
          `trong migration (BẤT BIẾN #2). Lưu ý: nếu đang chạy trên DB test thì hàng lệch có thể do ` +
          `spec khác vừa gieo cố ý (\`seedCrossTenantViolation\`) — đo lại trên DB tĩnh.`,
      ).toEqual([]);
    },
  );

  it("(d) KHÔNG waiver mồ côi — cặp đã hết tồn tại phải gỡ khỏi sổ phán quyết", async () => {
    const live = new Set((await census()).map(pairKey));
    const orphan = FK_TENANT_WAIVERS.filter((w) => !live.has(w.pair)).map((w) => w.pair);
    expect(
      orphan,
      `Waiver trỏ tới cặp FK không còn tồn tại. Waiver mồ côi làm sổ phán quyết trông đầy đủ hơn ` +
        `thực tế và che mất cặp mới cùng tên.`,
    ).toEqual([]);
  });

  it("(e) waiver chỉ hợp lệ cho bảng đích là catalog toàn cục (lớp G)", async () => {
    // Chốt chống lạm dụng: không ai được ký waiver cho một cặp lớp T chỉ vì ngại vá.
    const byKey = new Map((await census()).map((p) => [pairKey(p), p]));
    const wrong = FK_TENANT_WAIVERS.filter((w) => byKey.get(w.pair)?.targetTenantOnly === true).map(
      (w) => w.pair,
    );
    expect(
      wrong,
      `Waiver cho cặp có bảng đích company_id NOT NULL (lớp T). Lớp T KHÔNG có lý do miễn: ` +
        `composite FK vá được và không phá tham chiếu nào.`,
    ).toEqual([]);
  });

  // ── Chất lượng của bản vá, không chỉ sự TỒN TẠI của nó (plan-reviewer 2026-07-31, finding #2) ──
  // "Có composite FK" chưa đủ. Một composite FK SAI KIỂU vẫn làm `covered = true` trong khi lỗ còn
  // nguyên hoặc tệ hơn. Ba assert dưới đây kiểm ĐÚNG ba cách sai đó.

  it("(f) composite `SET NULL` PHẢI kèm danh sách cột — nếu không nó NULL luôn company_id", async () => {
    // Tiền lệ đã ghi sẵn ở `0503`: `ON DELETE SET NULL` trần set NULL cho MỌI cột tham chiếu, tức cả
    // `company_id`. Bảng con NOT NULL ⇒ xoá cha NỔ; bảng con NULLABLE ⇒ hàng thành vô chủ, NGOÀI RLS.
    const bad = (await census())
      .filter((p) => p.covered && !p.coveringSetNullHasColumnList)
      .map((p) => `${pairKey(p)} (${p.coveringConstraint})`);
    expect(
      bad,
      `Composite FK dùng \`ON DELETE SET NULL\` TRẦN. Sửa thành \`ON DELETE SET NULL (<cột>)\`.`,
    ).toEqual([]);
  });

  it("(g) composite FK phải trỏ ĐÚNG (company_id, id) của bảng cha", async () => {
    const bad = (await census())
      .filter((p) => p.covered && !p.coveringTargetsCompanyAndId)
      .map((p) => `${pairKey(p)} (${p.coveringConstraint})`);
    expect(
      bad,
      `Composite FK trỏ tới cặp cột KHÁC (company_id, id) ⇒ nó ràng buộc một quan hệ khác với quan hệ ` +
        `gốc, và lỗ KI-046 vẫn mở dù census thấy "đã phủ".`,
    ).toEqual([]);
  });

  it("(h) FK một-cột phải tham chiếu `id` — giả định mà bản vá đang dựa lên", async () => {
    // `suggestedFix()` và mig 0535 đều sinh `REFERENCES <tgt> (company_id, id)`. Nếu xuất hiện FK trỏ
    // tới một cột UNIQUE khác, bản vá sẽ tạo quan hệ SAI mà không ai thấy.
    const bad = (await census())
      .filter((p) => p.tgtColumn !== "id")
      .map((p) => `${pairKey(p)} → ${p.tgtTable}.${p.tgtColumn}`);
    expect(
      bad,
      `FK tham chiếu cột khác \`id\`. Bản vá composite giả định đích là (company_id, id) — phải xử lý ` +
        `riêng cặp này thay vì để nó chảy qua khuôn chung.`,
    ).toEqual([]);
  });

  it("(i) bảng đích lớp T phải GIỮ `company_id NOT NULL` — tiền đề sống của toàn bộ bản vá", async () => {
    // Lớp thứ ba plan bỏ sót: "NOT NULL hôm nay, chia sẻ ngày mai". Nếu ai nới một bảng đích thành
    // nullable để thêm hàng catalog toàn cục (đúng kịch bản `roles`/`public_holidays` đã xảy ra), thì
    // composite FK có sẵn sẽ CHẶN mọi tham chiếu tới hàng toàn cục mới đó bằng 23503 lúc chạy — mà
    // ratchet (a)/(b) vẫn xanh vì cặp vẫn `covered`. Assert này là thứ duy nhất bắt được.
    const all = await census();
    const tgtOfCovered = new Set(all.filter((p) => p.covered).map((p) => p.tgtTable));
    const loosened = all
      .filter((p) => tgtOfCovered.has(p.tgtTable) && !p.targetTenantOnly)
      .map((p) => p.tgtTable);
    expect(
      [...new Set(loosened)],
      `Bảng đích của composite FK vừa bị nới \`company_id\` thành NULLABLE. Hoặc hoàn lại NOT NULL, ` +
        `hoặc GỠ composite FK trỏ tới nó và ký waiver lớp G — không được để cả hai cùng tồn tại.`,
    ).toEqual([]);
  });

  it("(j) PIN lớp P (bịt một nửa): số cặp có `src.company_id` NULLABLE không được tăng", async () => {
    // MATCH SIMPLE bỏ qua hàng có NULL trong tập cột FK ⇒ với những cặp này composite FK KHÔNG kiểm
    // hàng `company_id IS NULL`. `covered = true` là ĐÚNG (constraint tồn tại) nhưng KHÔNG có nghĩa
    // "kín 100%". Pin để bảng con nullable-company_id mới không lặng lẽ nhập nhóm này.
    const partial = (await census()).filter((p) => !p.sourceTenantOnly);
    expect(
      partial.length,
      `Số cặp lớp P = ${partial.length} (đo 2026-07-31: ${PARTIAL_ENFORCEMENT_PAIRS}). Bảng con mới có ` +
        `\`company_id\` NULLABLE ⇒ composite FK của nó chỉ bịt một nửa. Nếu là chủ đích, cập nhật con ` +
        `số kèm lý do; nếu không, cân nhắc đặt \`company_id NOT NULL\`.\n` +
        `Danh sách: ${[...new Set(partial.map((p) => p.srcTable))].join(", ")}`,
    ).toBeLessThanOrEqual(PARTIAL_ENFORCEMENT_PAIRS);
  });

  it("(k) bảng RLS KHÔNG có cột company_id phải được KÝ NHẬN — chúng nằm ngoài tầm nhìn census", async () => {
    // Census chỉ thấy bảng CÓ `company_id`. Bảng cô lập tenant bằng tương quan (vd `role_permissions`
    // ép qua `roles.company_id`) vô hình với mọi assert phía trên — đúng lớp mù đã đẻ ra KI-041.
    const unsigned = (await collectRlsTablesWithoutCompanyId(direct)).filter(
      (t) => !RLS_TABLES_WITHOUT_COMPANY_ID.includes(t),
    );
    expect(
      unsigned,
      `Bảng RLS mới không có cột \`company_id\` ⇒ KHÔNG cặp FK nào của nó bị census/ratchet soi. Hoặc ` +
        `thêm \`company_id\` (mặc định đúng), hoặc ký nhận ở \`RLS_TABLES_WITHOUT_COMPANY_ID\` kèm lý ` +
        `do cô lập tenant bằng cơ chế gì.`,
    ).toEqual([]);
  });

  /**
   * Artifact máy-đọc — nguồn số liệu cho RELEASE-02 KI-046 và cho phiên sau.
   * Sinh lại: `FK_CENSUS_WRITE=1 LANE_DB=<lane> pnpm --filter @mediaos/api exec vitest run test/integration/xtenant-fk-ratchet.int-spec.ts`
   */
  it("artifact census (chỉ ghi khi FK_CENSUS_WRITE=1)", async () => {
    const all = await census();
    const summary = {
      total: all.length,
      covered: all.filter((p) => p.covered).length,
      open: all.filter((p) => !p.covered).length,
      classT: all.filter((p) => p.targetTenantOnly).length,
      classG: all.filter((p) => !p.targetTenantOnly).length,
      openClassT: all.filter((p) => p.targetTenantOnly && !p.covered).length,
    };
    expect(summary.total).toBe(summary.covered + summary.open);

    if (process.env.FK_CENSUS_WRITE !== "1") return;
    // tsconfig module=commonjs ⇒ dùng __dirname (mẫu route-guard-coverage.e2e-spec).
    const out = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "docs",
      "_review",
      "S6-SEC-XTENANTFK-1-fk-census.json",
    );
    mkdirSync(dirname(out), { recursive: true });
    const body = JSON.stringify({ summary, pairs: all }, null, 2) + "\n";
    if (!existsSync(out) || readFileSync(out, "utf8") !== body) writeFileSync(out, body, "utf8");
  });
});
