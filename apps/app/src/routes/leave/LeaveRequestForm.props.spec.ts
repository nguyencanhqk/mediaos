/**
 * S18-FE-LEAVEDRAFTCAST-1 (vá review LIGHT) — props của LeaveRequestForm là UNION PHÂN BIỆT theo `mode`.
 *
 * Trước vá: `mode?: "create" | "edit"; requestId?: string` — "requestId BẮT BUỘC khi edit" chỉ nằm trong
 * comment, và call-site PATCH phải ép `requestId as string`. Hệ quả: `<LeaveRequestForm mode="edit" />` thiếu
 * requestId vẫn biên dịch XANH, submit thì gửi PATCH `/leave/requests/undefined` (server 400/404, người dùng
 * chỉ thấy lỗi chung). Union `{ mode: "edit"; requestId: string } | { mode?: "create" }` dời luật đó vào kiểu ⇒
 * cú ép `as string` biến mất và call-site sai bị tsc chặn.
 *
 * Lưới COMPILE-TIME: vitest chạy `expectTypeOf` là no-op — người ép là `tsc` của
 * `pnpm --filter @mediaos/app typecheck` (tsconfig include `src` ⇒ spec cũng bị soát). Mỗi ca "KHÔNG gán được"
 * đi kèm ca đối chứng dương "gán được" để chứng minh phép so có răng (không xanh-rỗng vì callbacks sai kiểu).
 */
import { describe, expectTypeOf, it } from "vitest";
import type { LeaveRequestFormProps } from "./LeaveRequestForm";

/** Callback bắt buộc ở mọi nhánh — tách riêng để mỗi ca chỉ khác nhau đúng ở `mode`/`requestId`. */
type Callbacks = {
  onSuccess: (id: string, status: string) => void;
  onCancel: () => void;
};

describe("LeaveRequestFormProps — requestId bắt buộc theo mode (ép bởi tsc)", () => {
  it("mode='edit' THIẾU requestId ⇒ KHÔNG gán được; có requestId ⇒ gán được (đối chứng dương)", () => {
    expectTypeOf<Callbacks & { mode: "edit" }>().not.toExtend<LeaveRequestFormProps>();
    expectTypeOf<
      Callbacks & { mode: "edit"; requestId: string }
    >().toExtend<LeaveRequestFormProps>();
  });

  it("mode='edit' với requestId có thể undefined ⇒ KHÔNG gán được (không lọt `string | undefined`)", () => {
    expectTypeOf<
      Callbacks & { mode: "edit"; requestId: string | undefined }
    >().not.toExtend<LeaveRequestFormProps>();
  });

  it("tạo mới (mặc định hoặc mode='create') KHÔNG cần requestId và không nhận requestId", () => {
    expectTypeOf<Callbacks>().toExtend<LeaveRequestFormProps>();
    expectTypeOf<Callbacks & { mode: "create" }>().toExtend<LeaveRequestFormProps>();
    // requestId ở nhánh tạo mới sẽ bị bỏ qua lặng lẽ (vẫn POST) ⇒ chặn từ kiểu cho khỏi tưởng là sửa.
    expectTypeOf<Callbacks & { requestId: string }>().not.toExtend<LeaveRequestFormProps>();
  });
});
