import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S7-CHAT-BE-4 — census tĩnh cho ĐƯỜNG ĐỌC RỘNG NHẤT của module.
 *
 * ┌─ VÌ SAO KIỂM BẰNG NGUỒN CHỨ KHÔNG BẰNG "GỌI API RỒI NHÌN KẾT QUẢ" ────────────────────────────┐
 * │ Một truy vấn tìm kiếm THIẾU vế membership vẫn trả kết quả TRÔNG ĐÚNG trên fixture nhỏ, vì người │
 * │ chạy test thường là thành viên của mọi phòng trong fixture. Ca int-spec bắt được nó chỉ khi có  │
 * │ đúng phòng-mình-không-thuộc-mà-có-tin-khớp — dễ mất khi ai đó dọn fixture. Census đọc NGUỒN thì │
 * │ đỏ ngay lúc vế biến mất, không phụ thuộc dữ liệu.                                                │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

function codeOf(file: string): string {
  return readFileSync(join(__dirname, file), "utf8");
}

/**
 * Nguồn ĐÃ GỠ chú thích — dùng cho mọi assert dạng "KHÔNG được chứa X".
 *
 * ⚠️ Không có bước này thì census bắt trúng chính lời giải thích của mình: một comment viết "cấm
 * `sql.raw`" hay "cặp `chat-oversight` không được xuất hiện ở đây" sẽ làm ca test ĐỎ, và cách sửa rẻ nhất
 * lúc đó là **xoá comment** — tức đánh đổi tài liệu tại chỗ lấy một ca test xanh. Đây là bẫy đã gặp thật
 * ở `guard-immutability` (memory `guard-immutability-matches-comments`).
 *
 * Assert dạng "PHẢI chứa X" thì dùng nguồn nguyên bản: chúng soi lời gọi thật, comment không tạo dương
 * tính giả vì chuỗi cần tìm là cú pháp gọi hàm.
 */
function executableCodeOf(file: string): string {
  return codeOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("chat-search.repository.ts — bộ điều kiện đọc phải MƯỢN, không được viết lại", () => {
  const repo = codeOf("chat-search.repository.ts");

  it("gọi `messageReadConditions` của ChatAccessService", () => {
    // ⚠️ `repoCode` (ĐÃ gỡ comment), KHÔNG phải `repo`. Chuỗi này cũng nằm trong jsdoc của repo, nên
    // assert trên nguồn nguyên bản sẽ PASS kể cả khi ai đó XOÁ lời gọi khỏi mảng `conds` — tức là neo
    // bảo mật quan trọng nhất của file lại là neo GIẢ. Đã đo bằng mutation, không phải lo xa.
    expect(repoCode).toContain("this.access.messageReadConditions(");
  });

  const repoCode = executableCodeOf("chat-search.repository.ts");

  it("KHÔNG tự dựng lại bất kỳ vế membership nào", () => {
    // Bản sao thứ hai của luật quyền là bản sao sẽ trôi — và ở đường này, trôi nghĩa là rò nội dung
    // toàn công ty. Mọi vế dưới đây PHẢI chỉ tồn tại trong `ChatAccessService`.
    for (const forbidden of [
      "chatRoomMembers.userId",
      "chatRoomMembers.leftAt",
      "chatRooms.deletedAt",
      "visibleFromSeqColumn(",
      "visible_from_seq",
    ]) {
      expect(repoCode, `vế membership bị chép lại trong repo tìm kiếm: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("loại tin ĐÃ THU HỒI ngay trong truy vấn (không để mapper lo)", () => {
    // Thu hồi KHÔNG xoá `body` (append-only) ⇒ `search_vector` vẫn khớp. Mapper che `body` nên nội dung
    // không rò, nhưng SỐ LƯỢNG kết quả thì rò: gõ từng từ khoá và đếm hit là đọc lại được nội dung tin
    // đã thu hồi, từng chữ một. Đó là oracle, cùng lớp với CHAT-ERR-001.
    expect(repo).toContain("isNull(chatMessages.recalledAt)");
  });

  it("dùng `websearch_to_tsquery` + `f_unaccent` + `'simple'` — cả ba đều bắt buộc", () => {
    expect(repo).toContain("websearch_to_tsquery('simple'");
    // `to_tsquery` NÉM lỗi cú pháp trên input người dùng (`&`, `|`, `!`, ngoặc lệch) ⇒ 500 từ ô tìm kiếm.
    expect(repoCode).not.toMatch(/[^_]to_tsquery\(/);
    // Quên `f_unaccent` ở VẾ TRUY VẤN ⇒ gõ CÓ DẤU ra 0 kết quả (cột generated đã unaccent lúc INSERT).
    expect(repo).toContain("public.f_unaccent(");
  });

  it("`q` là tham số BIND — cấm nối chuỗi thô trên đường rộng nhất module", () => {
    expect(repoCode).not.toContain("sql.raw");
    // Nội suy trong `sql` template của drizzle sinh placeholder + params, không nối chuỗi.
    expect(repo).toContain("${opts.q}");
  });

  it("KHÔNG có nhánh đọc-vượt: cặp `chat-oversight` không xuất hiện", () => {
    // SPEC-15 §3.3 + API-13 §5.3 ràng buộc 5: `/chat/search` giữ vị từ membership cho MỌI role, kể cả
    // Super Admin. Không có `/chat/oversight/search`. Thêm vào là mở lại CHAT-DEC-004 với owner.
    for (const file of [
      "chat-search.repository.ts",
      "chat-search.service.ts",
      "chat-search.controller.ts",
    ]) {
      expect(executableCodeOf(file), `${file} chạm cặp đọc-vượt`).not.toContain("chat-oversight");
    }
  });

  it("khoá sắp xếp cắt về mili-giây ở CẢ hai vế (khoá + con trỏ)", () => {
    // `created_at` là micro-giây, con trỏ chỉ mang mili-giây ⇒ so sánh trên cột thô loại nhầm các hàng
    // cũ hơn trong cùng mili-giây ⇒ trang sau SÓT TIN, HTTP 200, không lỗi.
    // ⚠️ `repoCode` — chuỗi `date_trunc('milliseconds'` cũng có trong jsdoc. Assert trên nguồn nguyên
    // bản PASS kể cả khi `sortAtExpr()` bị đổi về cột thô, và khi đó lỗ "trang sau sót tin, HTTP 200,
    // không lỗi" KHÔNG còn neo nào chạy trong CI (int-spec ca 21 bị SKIP khi thiếu `LANE_DB`).
    expect(repoCode).toContain("date_trunc('milliseconds'");
    expect(repoCode).toContain("desc(sortAt)");
    // Vế phá hoà — thiếu nó thì hai tin cùng mốc làm con trỏ lặp/sót.
    expect(repoCode).toContain("desc(chatMessages.id)");
  });

  it("lấy `limit + 1` để biết còn trang sau mà không cần COUNT(*)", () => {
    expect(repo).toContain("opts.limit + 1");
  });

  it("controller khai `@UsePipes(ZodValidationPipe)` — thiếu nó thì MỌI trần thành trang trí", () => {
    // Gỡ decorator này ⇒ `q`/`limit`/`cursor` hết validate: câu 10KB đi thẳng vào
    // `websearch_to_tsquery`, `limit` không còn trần. Neo duy nhất trước đây là int-spec ca 10/16/22 —
    // mà int-spec **bị SKIP khi thiếu `LANE_DB`**, tức không chạy trong CI (memory
    // `ci-skips-most-integration-specs`). Ca này chạy ở tầng unit nên luôn có mặt.
    expect(executableCodeOf("chat-search.controller.ts")).toContain("@UsePipes(ZodValidationPipe)");
  });

  it("`leftJoin(users)` bó tenant cả hai vế", () => {
    expect(repo).toContain("eq(users.companyId, chatMessages.companyId)");
  });
});

describe("chat-access.service.ts — `messageReadConditions` đủ 5 vế", () => {
  const svc = codeOf("chat-access.service.ts");
  const body = svc.slice(svc.indexOf("messageReadConditions("));

  it("vế 1 — nối tin ↔ phòng (vế HAY BỊ QUÊN NHẤT: thiếu nó là tích Descartes)", () => {
    expect(body).toContain("eq(chatRooms.id, chatMessages.roomId)");
    expect(body).toContain("eq(chatRooms.companyId, chatMessages.companyId)");
  });

  it("vế 2+3 — membership đang hoạt động (mượn `activeMembershipJoin`, không chép)", () => {
    expect(body).toContain("this.activeMembershipJoin(actorUserId)");
  });

  it("vế 4 — phòng còn sống (mượn `visibleRoom`, không chép)", () => {
    expect(body).toContain("this.visibleRoom(companyId)");
  });

  it("vế 5 — vị từ §13.4 dạng CỘT", () => {
    expect(body).toContain("visibleFromSeqColumn()");
  });

  it("`company_id` của chính bảng tin được bó TƯỜNG MINH, không chỉ suy ra bắc cầu", () => {
    expect(body).toContain("eq(chatMessages.companyId, companyId)");
  });
});
