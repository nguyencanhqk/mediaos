// harness/id-uniqueness.test.mjs — cổng ép DUY NHẤT cho các họ ĐỊNH DANH mà git KHÔNG bảo vệ được.
//
// ─────────────────────────────────────────────────────────────────────────────
// MỨC ĐỘ (đọc trước khi sửa): đây là nợ SỔ SÁCH, KHÔNG phải lỗ bảo mật. Không rò dữ liệu, không
// hỏng runtime. Giá trị của cổng này là chặn việc BIẾN MẤT ÂM THẦM — thứ mà mọi lưới khác đều mù.
// ─────────────────────────────────────────────────────────────────────────────
//
// Hai ca bệnh THẬT (đo 2026-08-25, đều đã vá TAY, chưa có cổng — WO S10-GOV-IDUNIQUE-1 / KI-079):
//
//   Ca 1 — mã WO trùng trong `harness/backlog.mjs`. Có ĐÚNG hai khối id "S10-QA-ROUTEHTTP-2":
//     khối ship 18/08 (12 route risk>=5) và khối seed KI-025 ngày 24/08. Trùng id là lỗi HAI TẦNG,
//     không phải một:
//       (a) tầng backlog — `gen-status`/`gen-plan-index` đếm và render theo id;
//       (b) tầng LEDGER — `harness/lib/wo-state.mjs#statusOverlay()` trả `Map<woId, bucket>`, tức
//           KHOÁ THEO id. Dấu 'finished' của khối ship áp thẳng lên khối seed ⇒ khối seed hiện ở
//           danh sách "Đã xong" của STATUS và KHÔNG BAO GIỜ lọt `isReady`. Một Work Order thật
//           biến mất khỏi hàng đợi mà không có lấy một dòng cảnh báo.
//     ⇒ Đừng nới luật này thành "cảnh báo": tầng (b) khiến trùng id = việc không bao giờ được làm.
//     Vá tay: PR #417 (gỡ khối trùng).
//
//   Ca 2 — số ADR trùng trong `docs/DECISIONS/`. master trước đợt merge có cao nhất `DECISIONS-09`.
//     PR #414 thêm `DECISIONS-10_Role_Membership_Absence_Signal.md`, PR #416 thêm
//     `DECISIONS-10_Catalog_FK_Company_Guard_Trigger.md`. KHÁC TÊN FILE ⇒ git merge SẠCH, không
//     xung đột, không ai thấy. Hệ quả: hai quyết định kiến trúc cùng số ⇒ mọi trích dẫn "DEC-010"
//     về sau là mơ hồ. Vá tay lúc merge (#414 → `DECISIONS-11`).
//
//   Ca 3 (cùng LỚP, thêm phòng thủ) — số hiệu `KI-0NN` trong `docs/RELEASE/RELEASE-02_*.md`. Chưa
//     từng trùng (đo 25/08: 78 số, 001→078, không hụt, không trùng), nhưng hai PR song song cùng
//     "lấy số kế tiếp" là kịch bản y hệt ca 2, chỉ khác là cùng MỘT file nên xác suất git bắt được
//     cao hơn — cao hơn, KHÔNG phải chắc chắn (hai hàng chèn ở hai vùng khác nhau vẫn merge sạch).
//
//   Ca 4 (mở rộng 31/08/2026, xem CHỔNG 4 cuối file) — số hiệu tài liệu ở MỌI họ dưới `docs/`,
//     không chỉ `DECISIONS`. C2 đúng LỚP nhưng hẹp PHẠM VI: quét 14 họ còn lại tìm được HAI số
//     trùng ĐANG SỐNG trên master (`API-10` ×2, `DEVOPS-10` ×2) — cùng kiểu "khác tên file ⇒ git
//     merge sạch" như ca 2, lần này không ai vá tay vì không ai thấy.
//
// KHÔNG phủ (khai rõ, không bỏ lửng):
//   - `docs/plans/INDEX.md` — TỰ SINH từ `backlog.mjs` bởi `harness/gen-plan-index.mjs`. Trùng ở đó
//     là HỆ QUẢ của trùng id backlog, không phải nguồn độc lập ⇒ cổng 1 đã phủ. Thêm cổng thứ hai
//     lên file sinh ra chỉ nhân đôi tiếng ồn.
//   - Tính ĐẦY ĐỦ (KI có ở §2 mà thiếu hàng §1, ADR có số mà không ai trích dẫn, số HỤT giữa dãy)
//     — đó là lớp "thiếu", khác lớp "trùng". Vẫn ngoài phạm vi.
//   - Trùng số GIỮA các họ (`API-10` vs `DB-10`) — HỢP LỆ theo thiết kế, C4 khoá theo (họ, số).
//
// LUẬT VIẾT CỔNG (đã trả học phí, xem [[index-ratchet-must-pin-definition-not-name]]):
//   1. Ghim ĐỊNH NGHĨA, không ghim TÊN. Số ADR TRÍCH từ tên file bằng regex, so sánh theo GIÁ TRỊ
//      SỐ (`DECISIONS-9` và `DECISIONS-09` PHẢI đụng nhau). Không hard-code danh sách số đang có —
//      hard-code thì thêm ADR mới là đỏ oan.
//   2. Mọi cổng phải có ca THỬ-NGƯỢC gieo dữ liệu trùng ⇒ cổng phải ĐỎ. Không có ca thử-ngược thì
//      cổng là xanh-RỖNG ([[deny-cases-vacuous-without-allow-case]]).
//   3. Chống xanh-RỖNG kiểu thứ hai: nếu regex trích trượt HẾT (đổi quy ước đặt tên, đổi thư mục)
//      thì tập rỗng cũng "không trùng" ⇒ xanh vĩnh viễn. Vì vậy mỗi cổng assert THÊM: số phần tử
//      trích được > 0 VÀ không còn phần tử nào không trích được
//      ([[identity-projection-census-misses-alias]]).
//
// Đặt ở `harness/` chứ không phải `apps/api/test/foundation/` vì `node --test` không cần DB, không
// cần build, không cần pnpm install ⇒ chạy được trên MỌI PR, kể cả PR docs-only.
// Chạy: `node --test harness/id-uniqueness.test.mjs`
// ⚠️ Job CI liệt kê file test TƯỜNG MINH (không glob): `.github/workflows/ci.yml` job `tooling` +
//    `.github/workflows/api.yml` bước "Tooling tests" + `harness/check.sh` step `tooling-tests`.
//    Thêm file test mới mà quên ba chỗ đó ⇒ spec tồn tại mà KHÔNG BAO GIỜ chạy.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { backlog } from "./backlog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DECISIONS_DIR = path.join(REPO_ROOT, "docs", "DECISIONS");
const RELEASE_KI_FILE = path.join(REPO_ROOT, "docs", "RELEASE", "RELEASE-02_Known_Issues_MVP.md");

// ─────────────────────────────────────────────────────────────────────────────
// HÀM THUẦN — nhận DỮ LIỆU (mảng/chuỗi), không đọc đĩa. Ca thử-ngược soi đúng những hàm này.
// ⚠️ Trường của entry tên là `value`, KHÔNG phải `key` — và đừng đổi lại. Bản nháp đầu dùng `key`,
//    khiến fixture `{ value: "S10-QA-ROUTEHTTP-2", … }` (khi đó là `key: "…"`) khớp luật gitleaks
//    `generic-api-key` (từ khoá key/secret/token + `:` + literal ≥10 ký tự [0-9a-zA-Z_.=-]) ⇒ secret-scan
//    ĐỎ OAN trên PR #418, phải amend commit chứ không vá bằng commit sau (leak nằm trong LỊCH SỬ nhánh).
// ─────────────────────────────────────────────────────────────────────────────

/** Trả [{ value, count, members[] }] cho mọi khoá xuất hiện >1 lần, sắp xếp ổn định theo khoá. */
export function findDuplicates(entries) {
  const byValue = new Map();
  for (const { value, member } of entries) {
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(member);
  }
  return [...byValue.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([value, members]) => ({ value, count: members.length, members }))
    .sort((a, b) => String(a.value).localeCompare(String(b.value)));
}

/**
 * Trích số ADR từ TÊN FILE. Ghim ĐỊNH NGHĨA:
 *   - tiền tố bắt buộc `DECISIONS-`, theo sau là chữ số, theo sau là `_` (phân cách với slug);
 *   - khoá so sánh là GIÁ TRỊ SỐ ⇒ `DECISIONS-9_…` và `DECISIONS-09_…` là TRÙNG.
 * Trả `null` khi tên file không theo quy ước (để ca chống-xanh-rỗng bắt được).
 */
export function parseAdrNumber(filename) {
  const m = /^DECISIONS-(\d+)_.+\.md$/.exec(filename);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Trích danh sách mã `KI-0NN` từ Ô ĐẦU của mỗi hàng bảng trong §1 "Bảng tổng hợp" của RELEASE-02.
 * §1 là SỔ ĐĂNG KÝ số hiệu; §2..§4 là văn xuôi/diễn giải nên KHÔNG tính (một KI được nhắc lại ở
 * §2 là bình thường, không phải trùng số). Một hàng có thể mang NHIỀU mã (vd `KI-009 / KI-010`) —
 * đó là hàng gộp hợp lệ, mỗi mã vẫn phải duy nhất trên toàn bảng.
 * Khoá so sánh là GIÁ TRỊ SỐ ⇒ `KI-79` và `KI-079` là TRÙNG.
 */
export function parseKiIdsFromRegistry(markdown) {
  const out = [];
  let inRegistry = false;
  let rowIndex = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      inRegistry = /^##\s+1\./.test(line);
      continue;
    }
    if (!inRegistry || !line.startsWith("|")) continue;
    rowIndex += 1;
    const firstCell = line.split("|")[1] ?? "";
    for (const m of firstCell.matchAll(/KI-(\d+)/g)) {
      out.push({ value: Number(m[1]), member: `§1 hàng ${rowIndex}: ${m[0]}` });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CỔNG 1 — mã Work Order trong harness/backlog.mjs
// ─────────────────────────────────────────────────────────────────────────────

test("C1 — mọi id trong backlog.mjs là DUY NHẤT (trùng ⇒ ledger overlay đóng dấu chéo, WO biến mất)", () => {
  const entries = backlog.map((item, i) => ({
    value: item.id,
    member: `backlog[${i}] ${String(item.title ?? "").slice(0, 60)}`,
  }));
  const dups = findDuplicates(entries);
  assert.deepEqual(
    dups.map((d) => `${d.value} ×${d.count}`),
    [],
    "Mã WO TRÙNG trong harness/backlog.mjs:\n" +
      dups
        .map((d) => `  ${d.value} ×${d.count}\n${d.members.map((m) => `    - ${m}`).join("\n")}`)
        .join("\n") +
      "\nHai khối cùng id ⇒ statusOverlay() khoá theo id ⇒ dấu của khối này áp lên khối kia. Đổi id một trong hai.",
  );
});

test("C1b — chống xanh-RỖNG: backlog có item và MỌI item đều mang id là chuỗi không rỗng", () => {
  assert.ok(backlog.length > 0, "backlog rỗng ⇒ cổng C1 xanh một cách RỖNG");
  const bad = backlog
    .map((item, i) => ({ i, id: item.id }))
    .filter(({ id }) => typeof id !== "string" || id.trim() === "");
  assert.deepEqual(bad, [], `item thiếu/sai trường id ⇒ lọt khỏi cổng C1: ${JSON.stringify(bad)}`);
});

test("C1-thử-ngược — gieo hai id trùng ⇒ cổng PHẢI phát hiện", () => {
  const seeded = [
    { value: "S10-QA-ROUTEHTTP-2", member: "khối ship 18/08" },
    { value: "S10-GOV-IDUNIQUE-1", member: "khối bình thường" },
    { value: "S10-QA-ROUTEHTTP-2", member: "khối seed KI-025 24/08" },
  ];
  const dups = findDuplicates(seeded);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].value, "S10-QA-ROUTEHTTP-2");
  assert.equal(dups[0].count, 2);
  assert.deepEqual(dups[0].members, ["khối ship 18/08", "khối seed KI-025 24/08"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// CỔNG 2 — số ADR trong docs/DECISIONS/
// ─────────────────────────────────────────────────────────────────────────────

function readDecisionFilenames() {
  return fs
    .readdirSync(DECISIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name)
    .sort();
}

test("C2 — không hai file nào trong docs/DECISIONS/ mang cùng số DECISIONS-NN", () => {
  const names = readDecisionFilenames();
  const entries = names
    .map((name) => ({ value: parseAdrNumber(name), member: name }))
    .filter((e) => e.value !== null);
  const dups = findDuplicates(entries);
  assert.deepEqual(
    dups.map((d) => `DECISIONS-${d.value} ×${d.count}`),
    [],
    "Số ADR TRÙNG (git KHÔNG báo xung đột vì khác tên file):\n" +
      dups
        .map((d) => `  DECISIONS-${d.value}\n${d.members.map((m) => `    - ${m}`).join("\n")}`)
        .join("\n") +
      "\nĐổi số của file merge SAU + sửa mọi trích dẫn tới nó.",
  );
});

test("C2b — chống xanh-RỖNG: có file ADR và MỌI file .md đều theo quy ước DECISIONS-NN_<slug>.md", () => {
  const names = readDecisionFilenames();
  assert.ok(
    names.length > 0,
    `docs/DECISIONS/ rỗng ⇒ cổng C2 xanh một cách RỖNG (${DECISIONS_DIR})`,
  );
  const unparsed = names.filter((n) => parseAdrNumber(n) === null);
  assert.deepEqual(
    unparsed,
    [],
    "file .md không trích được số ⇒ NẰM NGOÀI cổng C2 (đổi quy ước đặt tên thì phải sửa parseAdrNumber, " +
      `đừng để cổng mù): ${unparsed.join(", ")}`,
  );
});

test("C2-thử-ngược — danh sách tên file giả có hai số 10 ⇒ cổng PHẢI phát hiện", () => {
  // Đúng ca bệnh thật: #414 và #416 cùng cấp DECISIONS-10, khác slug ⇒ git merge sạch.
  const fake = [
    "DECISIONS-09_Security_Policy_Reauth_And_Object_Grant.md",
    "DECISIONS-10_Catalog_FK_Company_Guard_Trigger.md",
    "DECISIONS-10_Role_Membership_Absence_Signal.md",
  ];
  const dups = findDuplicates(fake.map((n) => ({ value: parseAdrNumber(n), member: n })));
  assert.equal(dups.length, 1);
  assert.equal(dups[0].value, 10);
  assert.deepEqual(dups[0].members, [
    "DECISIONS-10_Catalog_FK_Company_Guard_Trigger.md",
    "DECISIONS-10_Role_Membership_Absence_Signal.md",
  ]);
});

test("C2-thử-ngược-2 — số so sánh theo GIÁ TRỊ, không theo CHUỖI: DECISIONS-9 đụng DECISIONS-09", () => {
  // Ghim ĐỊNH NGHĨA: nếu ai đó đổi parseAdrNumber sang so sánh chuỗi thì ca này ĐỎ.
  const fake = ["DECISIONS-9_A.md", "DECISIONS-09_B.md"];
  const dups = findDuplicates(fake.map((n) => ({ value: parseAdrNumber(n), member: n })));
  assert.equal(dups.length, 1, "DECISIONS-9 và DECISIONS-09 phải bị coi là cùng số");
  assert.equal(dups[0].value, 9);
});

// ─────────────────────────────────────────────────────────────────────────────
// CỔNG 3 — số hiệu KI-0NN trong sổ RELEASE-02 §1
// ─────────────────────────────────────────────────────────────────────────────

test("C3 — mọi mã KI-0NN ở §1 RELEASE-02 là DUY NHẤT", () => {
  const md = fs.readFileSync(RELEASE_KI_FILE, "utf8");
  const dups = findDuplicates(parseKiIdsFromRegistry(md));
  assert.deepEqual(
    dups.map((d) => `KI-${String(d.value).padStart(3, "0")} ×${d.count}`),
    [],
    "Số hiệu KI TRÙNG ở §1:\n" +
      dups
        .map(
          (d) =>
            `  KI-${String(d.value).padStart(3, "0")}\n${d.members.map((m) => `    - ${m}`).join("\n")}`,
        )
        .join("\n") +
      '\nHai PR song song cùng lấy "số kế tiếp" — đổi số của cái merge SAU.',
  );
});

test("C3b — chống xanh-RỖNG: §1 RELEASE-02 phải trích được mã KI", () => {
  const md = fs.readFileSync(RELEASE_KI_FILE, "utf8");
  const ids = parseKiIdsFromRegistry(md);
  assert.ok(
    ids.length > 0,
    `không trích được mã KI nào từ §1 (${RELEASE_KI_FILE}) ⇒ cổng C3 xanh một cách RỖNG — ` +
      'nhiều khả năng tiêu đề "## 1." hoặc dạng bảng đã đổi, sửa parseKiIdsFromRegistry',
  );
});

test("C3-thử-ngược — sổ giả có hai KI-079 ⇒ cổng PHẢI phát hiện; §2 nhắc lại thì KHÔNG", () => {
  const md = [
    "# RELEASE-02",
    "",
    "## 1. Bảng tổng hợp",
    "",
    "| ID | Vấn đề |",
    "| --- | --- |",
    "| **KI-078** | mô tả |",
    "| **KI-079** | PR A |",
    "| **KI-079** | PR B |",
    "",
    "## 2. Chi tiết",
    "",
    "### KI-079 — diễn giải (nhắc lại, KHÔNG phải trùng số)",
    "| ID | ghi chú |",
    "| --- | --- |",
    "| KI-079 | bảng phụ trong phần văn xuôi |",
  ].join("\n");
  const dups = findDuplicates(parseKiIdsFromRegistry(md));
  assert.equal(dups.length, 1, "chỉ §1 được tính là sổ đăng ký");
  assert.equal(dups[0].value, 79);
  assert.equal(dups[0].count, 2);
});
// ─────────────────────────────────────────────────────────────────────────────
// CỔNG 4 — số hiệu tài liệu trong MỌI họ đánh số dưới docs/ (SPEC · DB · API · BACKEND · FRONTEND ·
// UI · QA · DEVOPS · IMPLEMENTATION · RELEASE · PRD · ISSUE-BOARD · COMPLIANCE · PROJECT-BASELINE ·
// DECISIONS).
//
// LÝ DO THÊM (31/08/2026, nối tiếp S10-GOV-IDUNIQUE-1 / KI-079): cổng C2 chỉ phủ `docs/DECISIONS/`,
// tức 1 trên 15 họ. Quét 14 họ còn lại ở head `050623a0` tìm được HAI SỐ TRÙNG ĐANG SỐNG TRÊN
// MASTER — cùng đúng lớp lỗi KI-079 mô tả, chỉ ở họ khác:
//
//   • `API-10` ×2 — `API-10 PERMISSION MATRIX.md` + `API-10 PERMISSION AUDIT REPORT.md` (cả hai
//     sinh cùng commit gốc `2591db13`). Repo có 180 trích dẫn "API-10" TRẦN ⇒ toàn bộ mơ hồ.
//     Vá: Matrix giữ 10, báo cáo rà soát → `API-16`.
//   • `DEVOPS-10` ×2 — `DEVOPS-10_Backup_Rollback_Disaster_Recovery.md` (bộ gốc `2591db13`) +
//     `DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md` (thêm sau ở #286 / S5-PERF-1,
//     GIÀNH số của file có sẵn). 37 trích dẫn "DEVOPS-10" trần. Vá: báo cáo perf → `DEVOPS-15`.
//
// Hai ca đó là bằng chứng C2 đúng LỚP nhưng hẹp PHẠM VI: chỉ chặn được họ ADR. C4 tổng quát hoá
// đúng hàm thuần của C2 (`parseAdrNumber`) sang mọi họ, giữ nguyên ba luật viết cổng ở đầu file.
//
// PHẠM VI QUÉT — khai rõ, không bỏ lửng:
//   - Quét CÁC THƯ MỤC CON CẤP 1 của `docs/`, chỉ file `.md` ngay trong đó (KHÔNG đệ quy: thư mục
//     con như `docs/API Design/openapi/`, `docs/QA/evidence/` là kho hiện vật, không có dãy số).
//   - BỎ QUA `docs/plans/` (file đặt theo MÃ WO ⇒ C1 đã phủ đúng nguồn đó) và `docs/_review/`
//     (ghi chép rà soát tự do, không có dãy số). Hai thư mục này được assert là TỒN TẠI ở C4b nên
//     danh sách bỏ qua không thể mục rữa trong im lặng.
//   - Số so sánh theo GIÁ TRỊ và TRONG CÙNG HỌ: `API-10` và `DB-10` KHÔNG phải trùng.
// ─────────────────────────────────────────────────────────────────────────────

const DOCS_DIR = path.join(REPO_ROOT, "docs");
/** Thư mục con của docs/ KHÔNG theo dãy số. C4b assert chúng tồn tại ⇒ danh sách không mục rữa. */
const DOCS_DIRS_WITHOUT_SERIES = ["plans", "_review"];

/**
 * Trích (họ, số) từ TÊN FILE tài liệu. Ghim ĐỊNH NGHĨA, không ghim TÊN HỌ:
 *   - họ = chuỗi CHỮ HOA, cho phép `-` bên trong (vd `PROJECT-BASELINE`, `ISSUE-BOARD`);
 *   - theo sau là `-` + chữ số, rồi `_` hoặc khoảng trắng ngăn với phần tên còn lại;
 *   - khoá so sánh gồm CẢ họ và GIÁ TRỊ SỐ ⇒ `API-9` đụng `API-09`, `API-10` KHÔNG đụng `DB-10`.
 * Trả `null` khi tên file không theo quy ước (để ca chống-xanh-rỗng bắt được).
 */
export function parseDocNumber(filename) {
  const m = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{1,3})[_ ].+\.md$/.exec(filename);
  if (!m) return null;
  return { family: m[1], number: Number(m[2]) };
}

/** Đọc các thư mục con cấp 1 của docs/ có đánh số dãy, trả [{ dir, files[] }] sắp xếp ổn định. */
function readNumberedDocDirs() {
  return fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !DOCS_DIRS_WITHOUT_SERIES.includes(d.name))
    .map((d) => d.name)
    .sort()
    .map((dir) => ({
      dir,
      files: fs
        .readdirSync(path.join(DOCS_DIR, dir), { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"))
        .map((f) => f.name)
        .sort(),
    }));
}

/** Gộp mọi thư mục thành entries cho findDuplicates. Khoá = `<HỌ>-<số đã chuẩn hoá về giá trị>`. */
export function docNumberEntries(dirs) {
  const entries = [];
  for (const { dir, files } of dirs) {
    for (const name of files) {
      const parsed = parseDocNumber(name);
      if (parsed === null) continue;
      entries.push({
        value: `${parsed.family}-${parsed.number}`,
        member: `docs/${dir}/${name}`,
      });
    }
  }
  return entries;
}

test("C4 — không hai file nào trong cùng một họ tài liệu docs/ mang cùng số", () => {
  const dups = findDuplicates(docNumberEntries(readNumberedDocDirs()));
  assert.deepEqual(
    dups.map((d) => `${d.value} ×${d.count}`),
    [],
    "Số hiệu tài liệu TRÙNG (git KHÔNG báo xung đột vì khác tên file):\n" +
      dups.map((d) => `  ${d.value}\n${d.members.map((m) => `    - ${m}`).join("\n")}`).join("\n") +
      "\nMọi trích dẫn tới SỐ đó đều mơ hồ. Đổi số của file thêm SAU (lấy số kế tiếp trong họ), sửa " +
      "mọi trích dẫn tới nó, và ghi một dòng 'đổi số' trong chính file đó để trích dẫn cũ còn lần ra được.",
  );
});

test("C4b — chống xanh-RỖNG: có thư mục để quét, mỗi thư mục có file, MỌI file .md trích được số", () => {
  const dirs = readNumberedDocDirs();
  assert.ok(
    dirs.length >= 10,
    `docs/ chỉ có ${dirs.length} thư mục đánh số ⇒ nhiều khả năng cấu trúc đã đổi, C4 sắp xanh RỖNG`,
  );

  const empty = dirs.filter((d) => d.files.length === 0).map((d) => d.dir);
  assert.deepEqual(empty, [], `thư mục rỗng ⇒ C4 xanh RỖNG cho họ đó: ${empty.join(", ")}`);

  const unparsed = dirs.flatMap(({ dir, files }) =>
    files.filter((n) => parseDocNumber(n) === null).map((n) => `docs/${dir}/${n}`),
  );
  assert.deepEqual(
    unparsed,
    [],
    "file .md không trích được (họ, số) ⇒ NẰM NGOÀI cổng C4. Đổi quy ước đặt tên thì phải sửa " +
      `parseDocNumber hoặc khai vào DOCS_DIRS_WITHOUT_SERIES, đừng để cổng mù: ${unparsed.join(", ")}`,
  );

  // Danh sách bỏ qua phải trỏ vào thư mục CÓ THẬT — đổi tên/xoá mà quên sửa thì cổng đỏ ngay,
  // thay vì âm thầm bỏ qua một thư mục khác.
  for (const dir of DOCS_DIRS_WITHOUT_SERIES) {
    assert.ok(
      fs.existsSync(path.join(DOCS_DIR, dir)),
      `DOCS_DIRS_WITHOUT_SERIES trỏ vào thư mục KHÔNG tồn tại: docs/${dir} — danh sách đã mục rữa`,
    );
  }
});

test("C4-thử-ngược — gieo đúng HAI ca bệnh thật (API-10 ×2, DEVOPS-10 ×2) ⇒ cổng PHẢI phát hiện", () => {
  const fake = [
    {
      dir: "API Design",
      files: [
        "API-09_FOUNDATION_API_Design.md",
        "API-10 PERMISSION AUDIT REPORT.md",
        "API-10 PERMISSION MATRIX.md",
      ],
    },
    {
      dir: "DEVOPS",
      files: [
        "DEVOPS-10_Backup_Rollback_Disaster_Recovery.md",
        "DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md",
      ],
    },
  ];
  const dups = findDuplicates(docNumberEntries(fake));
  assert.deepEqual(
    dups.map((d) => `${d.value} ×${d.count}`),
    ["API-10 ×2", "DEVOPS-10 ×2"],
  );
  assert.deepEqual(dups[1].members, [
    "docs/DEVOPS/DEVOPS-10_Backup_Rollback_Disaster_Recovery.md",
    "docs/DEVOPS/DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md",
  ]);
});

test("C4-thử-ngược-2 — khoá gồm CẢ HỌ: API-10 và DB-10 KHÔNG trùng; API-9 và API-09 thì CÓ", () => {
  const khacHo = [
    { dir: "API Design", files: ["API-10 PERMISSION MATRIX.md"] },
    {
      dir: "DB",
      files: ["DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md"],
    },
  ];
  assert.deepEqual(
    findDuplicates(docNumberEntries(khacHo)),
    [],
    "cùng SỐ nhưng khác HỌ ⇒ hợp lệ; gộp khoá theo số trần là đỏ oan cho gần như mọi tài liệu",
  );

  const cungHoLechSo = [{ dir: "API Design", files: ["API-9 A.md", "API-09 B.md"] }];
  const dups = findDuplicates(docNumberEntries(cungHoLechSo));
  assert.equal(
    dups.length,
    1,
    "API-9 và API-09 phải bị coi là cùng số (so theo GIÁ TRỊ, không theo CHUỖI)",
  );
  assert.equal(dups[0].value, "API-9");
});
