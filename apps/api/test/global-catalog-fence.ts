import { Pool } from "pg";
import { parseDbName, resolveTestDbUrls } from "./db-target";

/**
 * S7-QA-CATALOGFIXTURE-1 — ĐAI THỨ HAI: catalog `permissions` KHÔNG được đổi cờ trong một lượt chạy.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY, KHI ĐÃ CÓ CHỐT Ở `seedPermissionCatalog`
 *
 * Chốt trong helper (`test/helpers/seed.ts`) là tuyến 1: nó ném NGAY tại spec gây ra, kèm tên cặp.
 * Nhưng nó chỉ canh được đường ĐI QUA nó. `permissions` là bảng toàn cục không có `company_id`
 * (⇒ `cleanupTenants()` không dọn), nên MỌI đường ghi khác đều bỏ qua tuyến 1:
 *
 *   • spec viết thẳng `UPDATE permissions SET is_sensitive = …` bằng `direct.query`;
 *   • một helper seed MỚI ai đó thêm sau này, chép nhầm khuôn upsert cũ;
 *   • code sản phẩm (seeder/bootstrap service) chạy trong int-spec và tự ghi catalog.
 *
 * Tuyến 2 không quan tâm ĐƯỜNG NÀO — nó chụp catalog trước suite, đối chiếu sau suite, và ĐỎ nếu cờ
 * của một cặp đã đổi. Cố ý KHÔNG pin một danh sách cặp cố định trong repo: pin danh sách thì mỗi
 * migration thêm quyền lại phải sửa fixture (churn + sẽ bị sửa cho xanh theo phản xạ). So-sánh
 * trước/sau đo đúng thứ cần đo — "lượt chạy test có làm đổi catalog không" — và tự động đúng với mọi
 * migration về sau, không cần bảo trì.
 *
 * Cặp MỚI xuất hiện là HỢP LỆ (fixture được phép tự chế cặp riêng của test — đó chính là lối thoát mà
 * thông báo lỗi của tuyến 1 chỉ sang). Chỉ ĐỔI CỜ và BIẾN MẤT mới là vi phạm.
 *
 * ⚠️ Đây là tuyến 2, KHÔNG thay tuyến 1: nó nói "có gì đó đã đổi cặp X" chứ không chỉ được spec nào
 * làm (suite chạy song song). Muốn biết thủ phạm thì tuyến 1 mới trả lời được — nên đừng gỡ tuyến 1
 * vì "đã có cái này rồi".
 *
 * ⚠️ GIỚI HẠN, NÓI THẲNG ĐỂ KHÔNG AI ĐỌC QUÁ LÊN: đây là phép so TRƯỚC/SAU **trong một lượt chạy**.
 * Nó bắt đúng lượt GÂY RA thay đổi. Một lane DB đã bẩn từ lượt TRƯỚC thì `before` đã mang giá trị bẩn
 * ⇒ lượt sau `before == after` ⇒ đai này IM LẶNG (đã đo, không phải suy đoán). Hai hệ quả:
 *   • CI luôn dựng DB mới mỗi lượt ⇒ ở CI đai này luôn bắt được;
 *   • máy local, lane DB dùng lại: thấy triệu chứng lạ về capability thì `--reset` lane rồi chạy lại,
 *     đừng tin "hôm nay không thấy đỏ" là bằng chứng sạch.
 */

export type CatalogFlags = Map<string, boolean>;

export interface CatalogDrift {
  /** Cặp đổi cờ — chuỗi đã format sẵn để in. */
  flipped: string[];
  /** Cặp có ở đầu suite nhưng biến mất ở cuối. */
  removed: string[];
}

/**
 * Phần LOGIC thuần của đai 2, tách khỏi I/O để unit-test được (mẫu: `test/db-target.unit-spec.ts`).
 *
 * Tách ra là có lý do, không phải cho đẹp: đai này chỉ nổ khi có người làm bẩn catalog, nên ở lượt
 * chạy bình thường nó KHÔNG được thực thi nhánh nào đáng kể ⇒ hỏng âm thầm qua vài lần refactor mà
 * không ai biết. `global-catalog-fence.unit-spec.ts` khoá 4 hành vi: flip → báo · removed → báo ·
 * **cặp MỚI → im lặng** (lối thoát hợp lệ cho fixture) · không đổi gì → im lặng.
 */
export function diffCatalogFlags(before: CatalogFlags, after: CatalogFlags): CatalogDrift {
  const flipped: string[] = [];
  const removed: string[] = [];
  for (const [pair, wasSensitive] of before) {
    if (!after.has(pair)) {
      removed.push(pair);
      continue;
    }
    const nowSensitive = after.get(pair);
    if (nowSensitive !== wasSensitive) {
      flipped.push(`${pair} : ${wasSensitive} → ${nowSensitive}`);
    }
  }
  return { flipped, removed };
}

async function readCatalog(url: string): Promise<CatalogFlags> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const res = await pool.query<{ action: string; resource_type: string; is_sensitive: boolean }>(
      `SELECT action, resource_type, is_sensitive FROM permissions`,
    );
    return new Map(res.rows.map((r) => [`${r.action}:${r.resource_type}`, r.is_sensitive]));
  } finally {
    await pool.end().catch(() => {});
  }
}

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const { DATABASE_DIRECT_URL } = resolveTestDbUrls(process.env);
  // Không có DB đích ⇒ run unit thuần, int-spec skip. Không có catalog để canh.
  if (!DATABASE_DIRECT_URL) return undefined;

  let before: CatalogFlags;
  try {
    before = await readCatalog(DATABASE_DIRECT_URL);
  } catch (err) {
    // FAIL-CLOSED. Bản đầu ở đây chỉ `console.warn` rồi `return undefined`, với lập luận "db-fence đã
    // fail-closed rồi, tới được đây tức là người chạy tự bật TEST_DB_FENCE_ALLOW_UNREACHABLE". FULL
    // gate bác đúng chỗ đó: lập luận ấy CHỈ đúng cho ca *không với tới DB*. Lỗi quyền, `permissions`
    // bị đổi tên, hay một lỗi kết nối NHẤT THỜI dưới tải (492 file × pool) đều rơi vào cùng nhánh này
    // ⇒ một dòng warn chìm trong log rồi CẢ ĐAI 2 TẮT cho lượt đó, exit 0. Đúng khuôn
    // "in-cảnh-báo-mà-CI-xanh" mà chính file này chống ở chỗ khác.
    //
    // Dùng LẠI đúng cổng đã có của db-fence thay vì đẻ biến bypass thứ hai: ca "không có DB" đã được
    // chặn sớm hơn ở nhánh `!DATABASE_DIRECT_URL` bên trên, nên fail-closed ở đây KHÔNG làm run
    // unit-only đỏ oan.
    if ((process.env.TEST_DB_FENCE_ALLOW_UNREACHABLE ?? "").trim() === "1") {
      console.warn(
        `[catalog-fence] ⚠ BỎ QUA theo TEST_DB_FENCE_ALLOW_UNREACHABLE=1: ${(err as Error).message}`,
      );
      return undefined;
    }
    throw new Error(
      `[catalog-fence] KHÔNG đọc được catalog \`permissions\` của DB "${parseDbName(DATABASE_DIRECT_URL) ?? "(không rõ)"}": ` +
        `${(err as Error).message}\n` +
        `Từ chối chạy suite (fail-closed) — chạy tiếp thì đai chống ô nhiễm catalog KHÔNG hoạt động mà ` +
        `không ai biết. Muốn bỏ qua có chủ đích: TEST_DB_FENCE_ALLOW_UNREACHABLE=1`,
    );
  }

  return async () => {
    const after = await readCatalog(DATABASE_DIRECT_URL);
    const { flipped, removed } = diffCatalogFlags(before, after);
    if (flipped.length === 0 && removed.length === 0) return;

    // ĐAI DỰ PHÒNG cho mã thoát — và đây là ĐÍNH CHÍNH một khẳng định SAI từng nằm ở đúng chỗ này.
    //
    // Bản đầu ghi "vitest 3.2.6 in lỗi teardown nhưng VẪN THOÁT 0, dòng này mới làm nó đỏ", kèm số đo.
    // Số đo đó KHÔNG HỢP LỆ: lượt "exit 0" ấy chạy trên lane DB đã bẩn SẴN từ lượt trước, nên
    // `before == after` ⇒ đai không hề nổ ⇒ thoát 0 là ĐÚNG, không liên quan gì tới dòng này.
    // FULL gate bác lại, và đo A/B lại trên trạng thái thực sự vi phạm (2026-08-03) cho:
    //     có dòng này → exit 1   ·   GỠ dòng này → exit 1
    // Lý do ở `vitest/dist/chunks/cac.0BJqEUeA.js:1421`: vitest bắt lỗi teardown rồi
    // `if (process.exitCode == null) process.exitCode = 1`.
    //
    // VẬY SAO CÒN GIỮ? Vì cái bảo đảm nằm ở vế `== null` — chỉ cần một bản vitest sau này set
    // `exitCode = 0` khi test xanh TRƯỚC lúc teardown chạy, nhánh đó im lặng và đai 2 thành
    // in-đỏ-mà-CI-xanh. Dòng này rẻ và đóng đúng kịch bản đó. Nó là phòng thủ, KHÔNG phải thứ đang
    // gánh hành vi hôm nay — đừng viết lại thành "đã đo là bắt buộc".
    process.exitCode = 1;

    const dbName = parseDbName(DATABASE_DIRECT_URL) ?? "(không rõ)";
    throw new Error(
      [
        "",
        "╔══════════════════════════════════════════════════════════════════════════════════╗",
        "║  DỪNG: lượt chạy test này ĐÃ LÀM ĐỔI catalog `permissions` (bảng TOÀN CỤC).     ║",
        "╚══════════════════════════════════════════════════════════════════════════════════╝",
        `  database : ${dbName}`,
        ...(flipped.length > 0
          ? ["", "  is_sensitive bị ĐỔI:", ...flipped.map((f) => `    • ${f}`)]
          : []),
        ...(removed.length > 0 ? ["", "  cặp BIẾN MẤT:", ...removed.map((p) => `    • ${p}`)] : []),
        "",
        "`permissions` không có `company_id` ⇒ cleanupTenants() KHÔNG dọn ⇒ thay đổi này TỒN TẠI SANG",
        "mọi lượt chạy sau trên chính DB này, và `is_sensitive` là cổng của getCapabilities()",
        "(permission.service.ts) ⇒ /auth/me của spec KHÁC sẽ thiếu/thừa cặp và đỏ ở nơi không liên quan.",
        "",
        "Cách xử:",
        "  1. Tìm đường ghi: grep 'permissions' trong spec vừa thêm/sửa (UPDATE thẳng? helper seed mới?).",
        "     Fixture đi qua seedPermissionCatalog() KHÔNG gây được lỗi này — nó đã ném trước (tuyến 1).",
        "  2. Cần cặp nhạy cảm để test → tự chế cặp RIÊNG của test, đừng mượn cặp sản phẩm.",
        "  3. Đổi cờ cặp chính tắc là việc của MIGRATION (+ SENSITIVE_CAPABILITY_ALLOWLIST + pin ở",
        "     auth-seed-canonical-roles.int-spec.ts), không phải của test.",
        "  4. Lane DB đã bẩn thì làm sạch: bash scripts/lane-db-setup.sh <lane> --reset",
        "",
      ].join("\n"),
    );
  };
}
