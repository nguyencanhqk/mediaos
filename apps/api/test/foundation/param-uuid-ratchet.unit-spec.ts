import { describe, expect, it } from "vitest";
import { idLikeParamSites, siteKey, unpipedIdParamSites } from "./param-uuid-census";
import {
  PARAM_UUID_VERDICTS,
  PARAM_UUID_MEASURED_FILES,
  PARAM_UUID_MEASURED_SIZE,
} from "./param-uuid-verdicts";

/**
 * S10-FND-PARAMUUID-1 (KI-077) — RATCHET kênh PARAM: **không mọc thêm** tham số `:id` bỏ validate.
 *
 * Song song với `body-validation-ratchet.unit-spec.ts` (kênh BODY, KI-068). Hai kênh, cùng một cơ
 * chế hỏng, nên phải có hai cái đếm — dấu gạch của KI-068 CHỈ phủ kênh BODY.
 *
 * KHÔNG cần Postgres: spec TĨNH ⇒ chạy ở MỌI lần `pnpm test`, không rơi vào lớp "xanh vì SKIP"
 * ([[integration-test-lane-db-gate]]).
 */

/**
 * TRẦN đóng băng theo SỐ ĐO **27/08/2026** — SAU khi `S10-CLEAN-WORKFLOWPARK-1` DỌN module
 * `workflow/`: `UNPIPED=1`.
 *
 * LỊCH SỬ (mỗi mốc là một WO đã ĐO bằng HTTP, không phải đếm tĩnh):
 *   226 → 221  S10-FND-PARAMUUID-1 (KI-077) — 5 tham số `foundation/files`, cả 5 đo được 500.
 *   221 → 190  S10-FND-PARAMUUID-2 (KI-078) — **31** tham số của nhóm đợt-1 (leave 15 · attendance
 *              14 · approval 2), cả 31 đo được 500 trước vá. Nhóm đợt-1 gồm **32** tham số nhưng
 *              tham số thứ 32 (`auth.controller.ts#revokeSession:id`) đo được **404** ⇒ CỐ Ý không
 *              vá ⇒ 221 − 31 = 190, KHÔNG phải 189.
 *   190 → 148  S10-FND-PARAMUUID-3 (KI-078 đợt 2) — **42** tham số mảng HR/tổ chức (employees 21 ·
 *              org 18 · positions 3), cả 42 đo được 500 trước vá, KHÔNG có phản-ví-dụ nào.
 *   148 → 112  S10-FND-PARAMUUID-4 (KI-078 đợt 3) — **36** tham số: goals 21 · foundation-ngoài-files
 *              8 · notifications 6 · recycle-bin 1. Cả 36 đo được 500 trước vá, KHÔNG phản-ví-dụ.
 *              Tiêu chí là CẤU TRÚC ("khép mọi module trong phạm vi TRỪ `tasks/`"), không phải rủi ro
 *              nghiệp vụ như hai đợt trước — xem `docs/plans/S10-FND-PARAMUUID-4.md` §2.
 *   112 → 37   S10-FND-PARAMUUID-5 (KI-078 đợt 4, **CUỐI trong phạm vi**) — **75** tham số của trọn
 *              module `tasks/`: tasks 43 · projects 13 · task-files 11 · labels 4 · project-states 4.
 *              Cả 75 đo được 500 trước vá, KHÔNG phản-ví-dụ. **KI-078 ĐÓNG tại đây.**
 *   37  → 1    S10-CLEAN-WORKFLOWPARK-1 — **KHÔNG PHẢI MỘT BẢN VÁ.** 36 tham số còn lại biến mất vì
 *              hai controller mang chúng bị **GỠ** (`workflow.controller.ts` 12 ·
 *              `workflow-templates.controller.ts` 24), không phải vì ai đó gắn pipe cho chúng.
 *              ⛔ Đừng đọc mốc này thành "đã đo + vá 36 route": 36 route đó CHƯA BAO GIỜ được đo
 *              bằng HTTP và giờ thì không còn tồn tại để đo. Xem `docs/plans/S10-CLEAN-WORKFLOWPARK-1.md`.
 *
 * ⚠️ ĐÂY LÀ TRẦN, KHÔNG PHẢI MỤC TIÊU — và từ đợt 4 nó KHÔNG còn là "nợ chưa đo" nữa.
 *
 * ⚠️ **1 KHÔNG PHẢI MỘT MÓN NỢ — nó là chỗ DUY NHẤT còn lại và đã có QUYẾT ĐỊNH.** Phân rã 27/08/2026
 * sau khi dọn `workflow/`:
 *     TRONG PHẠM VI, chưa đo: **0**. Mọi module nghiệp vụ trong phạm vi đã ĐO bằng HTTP và đã vá;
 *       tổng **183** site nằm trong `PARAM_UUID_MEASURED_FILES` với một dòng verdict mỗi site
 *       (185 → 183 vì `S10-CLEAN-WORKFLOWCLUSTER-2` XOÁ CẢ module `approval/` — lý do đầy đủ ở
 *       docblock của `PARAM_UUID_MEASURED_SIZE`).
 *     NGOÀI PHẠM VI: **0** — vế 36 tham số của `workflow/` đã hết vì code mang chúng bị GỠ.
 *     ĐÃ KÝ `skipped` (**1**): `auth/` — quyết định có ý thức, không phải nợ.
 *   ⇒ Trần này giờ là SÀN: nó chỉ tụt tiếp nếu `auth.controller.ts#revokeSession:id` đổi quyết định,
 *     mà quyết định đó là CỐ Ý (gắn pipe sẽ tách 400 khỏi 404 ⇒ đẻ oracle liệt kê session id).
 *     ⛔ Mọi con số > 1 từ giờ là nợ MỚI lẻn vào, không phải tàn dư.
 *
 * ⚠️ HẠ TRẦN LÀ HÀNH VI ĐÚNG. Vá một chỗ ⇒ số giảm ⇒ hạ hằng này xuống theo. Ca (3) ép điều đó:
 * để trần cao hơn thực tế là để lại chỗ trống cho nợ mới lẻn vào mà không ai thấy.
 *
 * ⚠️ Ca (3) là ĐẲNG THỨC trên census SỐNG ⇒ một PR khác thêm/bớt `@Param` id-like sẽ làm nó đỏ ở PR
 * này. Đó là TÍNH NĂNG (hai PR cùng chạm nợ phải gặp nhau), cách xử lý là rebase + chạy lại census
 * ngay trước commit cuối, KHÔNG phải nới ca (3) thành `toBeLessThanOrEqual`.
 *
 * ⛔ NÂNG TRẦN là tuyên bố thêm nợ, phải giải trình trong PR.
 */
const UNPIPED_CEILING = 1;

/**
 * Module ĐÃ VÁ ⇒ đòi bằng 0, không đòi "không tăng". Để một module đã sạch chỉ chịu trần chung nghĩa
 * là tham số kế tiếp của chính nó lẻn vào được mà ca (2) vẫn xanh.
 *
 * ⟲ S10-FND-PARAMUUID-2 (KI-078) — danh sách nới từ 1 lên 10 prefix. **Chỉ prefix mà census ĐO ĐƯỢC
 * bằng 0 mới vào**, không prefix nào vào theo kỳ vọng. Đo 26/08/2026 sau bản vá:
 *
 *   ĐO BẰNG HTTP Ở WO ĐÓ (3 int-spec RED→GREEN):   leave/ 15→0 · attendance/ 14→0 · approval/ 2→0
 *   ĐÃ SẠCH SẴN, ghim để khỏi tụt lại:             api-keys/ · chat/ · dashboard/ · permission/ ·
 *                                                  user-invites/ · users/ (+ foundation/files/)
 *
 * ⟲ S10-FND-PARAMUUID-3 (KI-078 đợt 2) — thêm 3 prefix, đo 27/08/2026 sau bản vá:
 *
 *   ĐO BẰNG HTTP Ở WO NÀY (3 int-spec RED→GREEN):  employees/ 21→0 · org/ 18→0 · positions/ 3→0
 *
 * ⟲ S10-FND-PARAMUUID-4 (KI-078 đợt 3) — thêm 3 prefix, đo 27/08/2026 sau bản vá:
 *
 *   ĐO BẰNG HTTP Ở WO NÀY (3 int-spec RED→GREEN):  goals/ 21→0 · notifications/ 6→0 ·
 *                                                  recycle-bin/ 1→0
 *
 * ⟲ S10-FND-PARAMUUID-5 (KI-078 đợt 4, CUỐI trong phạm vi) — thêm 1 prefix, đo 27/08/2026 sau bản vá:
 *
 *   ĐO BẰNG HTTP Ở WO NÀY (3 int-spec RED→GREEN):  tasks/ 75→0
 *
 *   `tasks/` là prefix HIẾM ở chỗ hai tập trùng khít: cả 5 controller mang `@Param` id-like đều được
 *   ĐO (75/75 site) và `task-attachments.controller.ts` có 0 site ⇒ prefix vừa SẠCH vừa ĐO ĐỦ. Đó là
 *   TRÙNG HỢP của module này, KHÔNG phải luật — xem cảnh báo `employees/` ngay trên.
 *
 *   Và NỚI `foundation/files/` → `foundation/`: đợt 3 đo + vá 8 site còn lại của `foundation/`
 *   (audit 2 · holidays 2 · retention 2 · sequences 2) nên CẢ prefix `foundation/` giờ ĐO ĐƯỢC bằng 0.
 *   Prefix hẹp cũ trở thành thừa — và để nó lại là để `foundation/<module mới>` lọt qua ca (1).
 *
 *   ⚠️ Prefix `employees/` bằng 0 nhờ CẢ HAI nguồn, và hai nguồn đó KHÔNG tương đương:
 *     · 21 site được ĐO + vá ở WO này (5 controller);
 *     · 7 site của `hr-write.controller.ts` + `hr-employee-avatar.controller.ts` ĐÃ CÓ pipe từ trước
 *       và **CHƯA ai đo bằng HTTP** ⇒ chúng KHÔNG nằm trong `PARAM_UUID_MEASURED_FILES`.
 *   Vì thế `CLEAN_PREFIXES` ("prefix này bằng 0") và `PARAM_UUID_MEASURED_FILES` ("mọi site trong file
 *   này đã được đo") là HAI tập KHÁC NHAU — đừng đồng bộ chúng cho "gọn".
 *
 * Phân biệt hai nhóm là CÓ CHỦ Ý: nhóm "sạch sẵn" CHƯA ai đo bằng HTTP, nên việc ghim chúng chỉ là
 * "không cho tụt lại", KHÔNG phải tuyên bố "đã kiểm chứng từng route".
 *
 * ⓘ `workflow/` KHÔNG còn trong census: `S10-CLEAN-WORKFLOWPARK-1` đã GỠ hai controller của nó.
 * Cũng KHÔNG thêm nó vào danh sách này — một prefix không còn file nào thì ca (1) lọc ra tập rỗng và
 * xanh vĩnh viễn, tức là ghim một lời hứa không ai đo. Prefix ở đây phải trỏ tới code ĐANG SỐNG.
 *
 * ⓘ `approval/` ĐÃ BỊ GỠ khỏi danh sách này ở `S10-CLEAN-WORKFLOWCLUSTER-2` theo ĐÚNG luật trên:
 * cả module bị xoá nên prefix không còn file nào. Nó từng đứng ở đây với tư cách "đo bằng HTTP ở
 * KI-078 đợt 1" — số đo đó CÓ THẬT, nhưng đối tượng đo không còn, và một prefix rỗng thì xanh vĩnh
 * viễn dù ngày mai ai đó dựng lại `approval/` với tham số unpiped.
 *
 * ⛔ `auth/` KHÔNG BAO GIỜ được vào danh sách này. Nó còn ĐÚNG MỘT tham số unpiped
 * (`auth.controller.ts#revokeSession:id`) và đó là quyết định CÓ Ý THỨC, không phải nợ: route đó đo
 * được **404** chứ không 500, và gắn pipe sẽ tách 400 khỏi 404 ⇒ đẻ oracle liệt kê session id. Lý do
 * đầy đủ nằm ở dòng verdict `skipped` trong `param-uuid-verdicts.ts`.
 *
 * ⛔ Module CÒN tham số bỏ qua có ý thức cũng KHÔNG được vào — prefix ở đây nghĩa là "bằng 0", không
 * phải "đã xem qua".
 */
const CLEAN_PREFIXES = [
  // Đo bằng HTTP ở KI-077 / KI-078 đợt 1:
  "leave/",
  "attendance/",
  // Đo bằng HTTP ở KI-078 đợt 2 (S10-FND-PARAMUUID-3):
  "employees/",
  "org/",
  "positions/",
  // Đo bằng HTTP ở KI-078 đợt 3 (S10-FND-PARAMUUID-4). `foundation/` THAY THẾ `foundation/files/`
  // của KI-077: đợt 3 vá nốt 8 site còn lại nên cả prefix rộng ĐO ĐƯỢC bằng 0.
  "foundation/",
  "goals/",
  "notifications/",
  "recycle-bin/",
  // Đo bằng HTTP ở KI-078 đợt 4 (S10-FND-PARAMUUID-5) — nợ THẬT cuối cùng trong phạm vi:
  "tasks/",
  // Sạch sẵn, ghim để không tụt lại:
  "api-keys/",
  "chat/",
  "dashboard/",
  "permission/",
  "user-invites/",
  "users/",
];

describe("S10-FND-PARAMUUID-1 — ratchet: tham số :id phải validate ở BIÊN", () => {
  it("(1) module ĐÃ SẠCH KHÔNG còn tham số id-like nào thiếu pipe", () => {
    const offenders = unpipedIdParamSites().filter((s) =>
      CLEAN_PREFIXES.some((p) => s.file.startsWith(p)),
    );
    const detail = offenders.map((s) => `  ${s.file}:${s.line}  @Param("${s.name}")`).join("\n");
    expect(
      offenders.length,
      offenders.length === 0
        ? ""
        : [
            "",
            `Có ${offenders.length} tham số id-like thiếu pipe trong module ĐÃ VÁ:`,
            detail,
            "",
            'Vá theo khuôn cùng cây: `@Param("id", ParseUUIDPipe) id: string`',
            "(`api-keys.controller.ts` dùng nó từ trước).",
            "",
            '⚠️ Route `unlink` có `:id` TRONG ĐƯỜNG DẪN nhưng handler KHÔNG KHAI `@Param("id")` —',
            "nó không đọc tham số đó bao giờ. Vì thế census KHÔNG thấy, và đó là ĐÚNG: không có gì để",
            'validate. Nếu ai đó thêm `@Param("id")` vào `unlink` thì ca này sẽ đỏ — hãy đọc docblock',
            "của route trước khi vá, vì việc BẮT ĐẦU đọc `:id` là một đổi hành vi, không phải sửa lint.",
          ].join("\n"),
    ).toBe(0);
  });

  it("(2) TOÀN API: số tham số id-like thiếu pipe KHÔNG vượt trần đã ký", () => {
    const all = unpipedIdParamSites();
    expect(
      all.length,
      `Có ${all.length} tham số id-like thiếu pipe, trần đã ký là ${UNPIPED_CEILING}.\n` +
        "Tham số MỚI viết theo khuôn cũ sẽ trả 500 SYSTEM-ERR-001 cho input rác thay vì 400 —\n" +
        "vừa sai hợp đồng API vừa bơm 500 GIẢ vào giám sát, làm loãng tín hiệu 500 THẬT.\n" +
        'Vá bằng `@Param("x", ParseUUIDPipe)`, hoặc nâng trần kèm giải trình trong PR.',
    ).toBeLessThanOrEqual(UNPIPED_CEILING);
  });

  it("(3) trần KHÔNG được để CAO HƠN thực tế — vá xong phải hạ trần", () => {
    // Trần cao hơn thực tế là chỗ trống cho nợ mới lẻn vào mà ca (2) vẫn xanh. Ca này biến việc hạ
    // trần thành BẮT BUỘC, không phải lịch sự ([[index-ratchet-must-pin-definition-not-name]]).
    expect(
      unpipedIdParamSites().length,
      `Đã vá bớt rồi — hạ UNPIPED_CEILING xuống ${unpipedIdParamSites().length} trong file này.`,
    ).toBe(UNPIPED_CEILING);
  });

  it("(4) census KHÔNG rỗng và phân biệt được CÓ pipe với KHÔNG — chống xanh-rỗng", () => {
    // Nếu scanner hỏng (đổi tên decorator, parse lỗi, đổi cây thư mục) thì ca (1)/(2) xanh vì KHÔNG
    // TÌM THẤY GÌ, không phải vì sạch ([[test-noise-anchor-hides-a-branch]]).
    const sites = idLikeParamSites();
    expect(sites.length, "scanner không thấy @Param id-like nào — nó đang hỏng").toBeGreaterThan(
      100,
    );
    // Neo DƯƠNG: phải thấy CẢ HAI phía. Chỉ thấy một phía nghĩa là cờ `hasPipe` đang hỏng cứng.
    expect(
      sites.filter((s) => s.hasPipe).length,
      "scanner không thấy tham số nào CÓ pipe — cờ hasPipe hỏng, mọi kết luận đều vô nghĩa",
    ).toBeGreaterThan(0);
    expect(
      sites.filter((s) => !s.hasPipe).length,
      "scanner không thấy tham số nào THIẾU pipe — cờ hasPipe hỏng theo chiều ngược lại",
    ).toBeGreaterThan(0);
    // Neo ALIAS: `:linkId` phải nằm trong census — grep theo `@Param("id")` sẽ trượt nó, và chính
    // cú trượt đó là lý do WO kê nó riêng ([[identity-projection-census-misses-alias]]).
    expect(
      sites.some((s) => s.name.endsWith("Id") && s.name !== "id"),
      "census chỉ thấy tham số tên đúng `id` — nó đang trượt các alias `*Id`",
    ).toBe(true);
  });

  /**
   * (5) SỔ PHÁN QUYẾT — S10-FND-PARAMUUID-2 (KI-078).
   *
   * Vì sao ca (2)/(3) KHÔNG đủ: chúng đếm TỔNG. Gỡ một pipe ở `leave` rồi thêm một pipe ở `tasks`
   * giữ nguyên tổng ⇒ cả hai ca xanh trong khi nhóm đã-đo vừa thủng. Ca này khoá theo TỪNG SITE.
   *
   * ⚠️ Assert HAI CHIỀU, cố ý:
   *   · `decision === 'piped'`  ⟹ `hasPipe === true`   (gỡ pipe ⇒ ĐỎ)
   *   · `decision === 'skipped'` ⟹ `hasPipe === false` (âm thầm gắn pipe vào chỗ đã ký "không vá"
   *     cũng ĐỎ — auth-session là quyết định, không phải nợ chờ ai đó tiện tay vá)
   * Chỉ kiểm "có tồn tại dòng verdict" là ca xanh cả sau khi gỡ pipe — đúng lớp "test ghim lỗ MỞ"
   * ([[tests-can-pin-a-hole-open]]).
   *
   * ⚠️ Ánh xạ site ↔ dòng verdict phải là SONG ÁNH: site thiếu dòng ⇒ ĐỎ (quên ký), dòng thừa/mồ côi
   * ⇒ ĐỎ (đổi tên handler làm khoá trỏ vào hư không mà sổ vẫn trông đầy đủ).
   */
  it("(5) sổ phán quyết KHỚP census theo TỪNG SITE, hai chiều", () => {
    const measured = idLikeParamSites().filter((s) => PARAM_UUID_MEASURED_FILES.includes(s.file));

    // Neo chống-xanh-rỗng: nếu bộ lọc trượt (đổi tên file, census hỏng) thì mọi assert dưới đây
    // xanh vì KHÔNG CÓ GÌ để so, không phải vì đúng.
    expect(
      measured.length,
      `Census chỉ thấy ${measured.length} site trong ${PARAM_UUID_MEASURED_FILES.length} controller ĐÃ ĐO, chờ ${PARAM_UUID_MEASURED_SIZE}.\n` +
        "Hoặc controller vừa đổi tên/đường dẫn (cập nhật PARAM_UUID_MEASURED_FILES), hoặc có `@Param`\n" +
        "id-like vừa được THÊM/XOÁ ở nhóm đã đo — cả hai đều cần một dòng verdict, không phải sửa số.",
    ).toBe(PARAM_UUID_MEASURED_SIZE);
    expect(
      PARAM_UUID_VERDICTS.length,
      "sổ phán quyết phải có ĐÚNG một dòng cho mỗi site trong các controller ĐÃ ĐO",
    ).toBe(PARAM_UUID_MEASURED_SIZE);

    // Khoá trùng ⇒ hai dòng cùng trỏ một site, và một site khác mất dòng mà tổng vẫn khớp.
    const byKey = new Map<string, (typeof PARAM_UUID_VERDICTS)[number]>();
    for (const v of PARAM_UUID_VERDICTS) {
      expect(byKey.has(v.key), `dòng verdict TRÙNG KHOÁ: ${v.key}`).toBe(false);
      byKey.set(v.key, v);
    }

    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const s of measured) {
      const key = siteKey(s);
      const v = byKey.get(key);
      if (!v) {
        missing.push(`  ${key}  (${s.file}:${s.line})`);
        continue;
      }
      byKey.delete(key);
      const wantPipe = v.decision === "piped";
      if (s.hasPipe !== wantPipe) {
        mismatched.push(
          `  ${key}  (${s.file}:${s.line})  sổ ghi '${v.decision}' nhưng code ` +
            `${s.hasPipe ? "CÓ" : "KHÔNG có"} pipe`,
        );
      }
    }

    expect(
      missing,
      missing.length === 0
        ? ""
        : [
            "",
            "Site trong nhóm ĐÃ ĐO mà KHÔNG có dòng trong `param-uuid-verdicts.ts`:",
            ...missing,
            "",
            "Thêm `@Param` id-like vào một trong 29 controller đã đo = tuyên bố mở rộng nhóm ⇒ phải",
            "ĐO bằng HTTP rồi ký một dòng verdict (`piped` hoặc `skipped` + số đo + lý do).",
            "Khoá là `file#handler:param` — đổi TÊN METHOD cũng làm dòng cũ mồ côi, hãy sửa khoá.",
          ].join("\n"),
    ).toEqual([]);

    expect(
      mismatched,
      mismatched.length === 0
        ? ""
        : [
            "",
            "Sổ phán quyết LỆCH với code — sửa MỘT trong hai, và sửa có chủ đích:",
            ...mismatched,
            "",
            "· sổ ghi 'piped' mà code hết pipe ⇒ ai đó vừa GỠ `ParseUUIDPipe`: route quay lại trả",
            "  500 SYSTEM-ERR-001 cho `:id` rác. Khôi phục pipe.",
            "· sổ ghi 'skipped' mà code CÓ pipe ⇒ ai đó vừa vá một chỗ đã ký 'không vá'. Với",
            "  `auth.controller.ts#revokeSession:id` việc này ĐỔI 404 thành 400 ⇒ tách được 'phiên",
            "  không tồn tại' khỏi 'id sai dạng' ⇒ đẻ oracle liệt kê session id. Đọc dòng verdict",
            "  trước khi 'sửa lint'.",
          ].join("\n"),
    ).toEqual([]);

    expect(
      [...byKey.keys()],
      "dòng verdict MỒ CÔI — census không còn site nào mang khoá này (đổi tên handler? xoá route?)",
    ).toEqual([]);

    // Neo DƯƠNG cuối: sổ phải thấy CẢ HAI quyết định. Nếu một ngày toàn bộ sổ hoá 'piped' thì
    // nhánh 'skipped' của assert trên KHÔNG BAO GIỜ chạy và ca này mất một nửa giá trị
    // ([[deny-cases-vacuous-without-allow-case]]).
    expect(
      PARAM_UUID_VERDICTS.filter((v) => v.decision === "piped").length,
      "sổ không có dòng 'piped' nào — nhánh đó của assert đang chạy rỗng",
      // 184 → 182 ở `S10-CLEAN-WORKFLOWCLUSTER-2`: hai dòng `piped` của
      // `approval/approval-inbox.controller.ts` bị gỡ vì CẢ MODULE bị xoá, không phải vì gỡ pipe.
      // Số này chỉ được hạ khi controller biến mất khỏi cây mã — xem `PARAM_UUID_MEASURED_SIZE`.
    ).toBe(182);
    expect(
      PARAM_UUID_VERDICTS.filter((v) => v.decision === "skipped").length,
      "sổ không có dòng 'skipped' nào — nhánh đó của assert đang chạy rỗng",
    ).toBe(1);
  });
});
