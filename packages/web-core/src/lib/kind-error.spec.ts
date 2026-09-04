import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { parseKindError, readDetailFields } from "./error-mapper";

/**
 * S14-FE-DEBT-1 — bản CHUNG của `readDetailFields` + `parse*Error`.
 *
 * Trước WO này có 4 bản chép tay (`asset-errors` · `payroll-errors` · `recruit-errors` ·
 * `room-errors`); riêng `readDetailFields` byte-identical cả 4. Bản chung phải giữ đúng
 * hai bất biến đã tốn tiền học:
 *
 * 1. `details` là **MẢNG** `ErrorDetail{field,message,rule}` — `kind` nằm ở phần tử
 *    `field==="kind"`, giá trị ở `.message`. Đọc `details` như OBJECT `{kind:…}` trả
 *    `undefined` và nuốt lỗi trong im lặng (memory `error-details-must-be-errordetail-array`).
 * 2. Hình sai KHÔNG được ném — trả bảng rỗng, vì đây nằm trên đường xử lý lỗi.
 */
describe("readDetailFields", () => {
  it("đọc mảng ErrorDetail thành bảng field → message", () => {
    const fields = readDetailFields([
      { field: "kind", message: "job-closed", rule: "business" },
      { field: "capacity", message: "8" },
    ]);
    expect(fields.get("kind")).toBe("job-closed");
    expect(fields.get("capacity")).toBe("8");
  });

  it("field TRÙNG: giữ phần tử ĐẦU, không để phần tử sau đè", () => {
    const fields = readDetailFields([
      { field: "kind", message: "dau" },
      { field: "kind", message: "sau" },
    ]);
    expect(fields.get("kind")).toBe("dau");
  });

  it("`details` là OBJECT (không phải mảng) ⇒ bảng RỖNG, KHÔNG ném", () => {
    // Đây chính là hình dạng đọc-sai đã đẻ ra lỗi câm: `{ kind: "job-closed" }`.
    expect(readDetailFields({ kind: "job-closed" }).size).toBe(0);
  });

  it("null/undefined/chuỗi/số ⇒ bảng RỖNG, KHÔNG ném", () => {
    for (const bad of [null, undefined, "kind", 7, true]) {
      expect(readDetailFields(bad).size).toBe(0);
    }
  });

  it("bỏ qua phần tử hỏng nhưng GIỮ phần tử hợp lệ cùng mảng", () => {
    const fields = readDetailFields([
      null,
      "khong-phai-object",
      { field: 1, message: "field sai kiểu" },
      { field: "ok", message: 2 },
      { field: "kind", message: "not-found" },
    ]);
    expect(fields.size).toBe(1);
    expect(fields.get("kind")).toBe("not-found");
  });
});

describe("parseKindError", () => {
  it("bóc code/status/kind/message/fields từ ApiError", () => {
    const err = new ApiError({
      status: 409,
      code: "RECRUIT-ERR-014",
      message: "Tin tuyển dụng đã đóng.",
      details: [
        { field: "kind", message: "job-closed" },
        { field: "jobOpeningId", message: "abc" },
      ],
    });
    const info = parseKindError(err);
    expect(info.code).toBe("RECRUIT-ERR-014");
    expect(info.status).toBe(409);
    expect(info.kind).toBe("job-closed");
    expect(info.message).toBe("Tin tuyển dụng đã đóng.");
    expect(info.fields.get("jobOpeningId")).toBe("abc");
  });

  it("ApiError KHÔNG kèm `kind` ⇒ kind null, các trường khác vẫn đủ", () => {
    const err = new ApiError({ status: 422, code: "VALIDATION-ERR-001", message: "Sai dữ liệu." });
    const info = parseKindError(err);
    expect(info.kind).toBeNull();
    expect(info.code).toBe("VALIDATION-ERR-001");
    expect(info.status).toBe(422);
  });

  it("lỗi KHÔNG phải ApiError (vd lỗi mạng) ⇒ code/status/kind null, giữ message", () => {
    const info = parseKindError(new Error("Failed to fetch"));
    expect(info.code).toBeNull();
    expect(info.status).toBeNull();
    expect(info.kind).toBeNull();
    expect(info.message).toBe("Failed to fetch");
    expect(info.fields.size).toBe(0);
  });

  it("giá trị ném không phải Error ⇒ message rỗng, KHÔNG ném tiếp", () => {
    const info = parseKindError("chuoi tran");
    expect(info.message).toBe("");
    expect(info.fields.size).toBe(0);
  });
});
