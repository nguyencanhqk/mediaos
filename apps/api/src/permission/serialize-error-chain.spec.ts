/**
 * S14-SEC-CAPWILDCARD-1 — `serializeErrorChain` / `safeErrorStack` KHÔNG BAO GIỜ ném.
 *
 * Vì sao là bất biến: hai hàm này chạy TRONG khối `catch` của `getCapabilities` / `getCapabilityScopes`
 * (nhánh trả `{}`) và trong `onError` của hai ảnh chụp catalog (nhánh fail-closed của `can()`). Hàm quan
 * sát mà ném ở đó thì chính đường suy biến an toàn hỏng theo: lỗi gốc bị thay bằng TypeError của bộ log.
 *
 * Giá trị "khó" lấy từ thực tế JS: `String(Object.create(null))` ném TypeError; `toString` /
 * `Symbol.toPrimitive` do người dùng định nghĩa có thể ném; getter `message` / `cause` / `stack` có thể ném;
 * `instanceof` trên Proxy có bẫy `getPrototypeOf` ném; chuỗi `cause` có thể vòng.
 */
import { describe, expect, it } from "vitest";
import { safeErrorStack, serializeErrorChain } from "./serialize-error-chain";

function throwingGetter<T extends object>(target: T, key: string): T {
  Object.defineProperty(target, key, {
    configurable: true,
    get() {
      throw new Error(`getter ${key} boom`);
    },
  });
  return target;
}

describe("serializeErrorChain — hình dạng bình thường giữ nguyên", () => {
  it("trải name · message · code · cause (mã PG trong cause)", () => {
    const pg = Object.assign(new Error("permission denied for table role_permissions"), {
      code: "42501",
    });
    const outer = new Error("Failed query", { cause: pg });

    expect(serializeErrorChain(outer)).toEqual({
      name: "Error",
      message: "Failed query",
      code: undefined,
      cause: {
        name: "Error",
        message: "permission denied for table role_permissions",
        code: "42501",
        cause: undefined,
      },
    });
  });

  it("giá trị không phải Error: chuỗi giữ nguyên, undefined giữ undefined, Symbol thành chuỗi", () => {
    expect(serializeErrorChain("pool exhausted")).toBe("pool exhausted");
    expect(serializeErrorChain(undefined)).toBeUndefined();
    expect(serializeErrorChain(Symbol("s"))).toBe("Symbol(s)");
  });

  it("trần độ sâu: chuỗi 10 tầng bị cắt bằng dấu cố định, không đệ quy hết", () => {
    let chain: Error = new Error("e9");
    for (let i = 8; i >= 0; i -= 1) chain = new Error(`e${i}`, { cause: chain });

    const json = JSON.stringify(serializeErrorChain(chain));
    expect(json).toContain("[cause chain truncated]");
    expect(json).not.toContain("e9");
  });
});

describe("serializeErrorChain — KHÔNG BAO GIỜ ném (đang chạy trong catch fail-closed)", () => {
  it("cause = Object.create(null) ⇒ không ném, cause thành dấu cố định", () => {
    const error = new Error("outer", { cause: Object.create(null) });

    let result: unknown;
    expect(() => {
      result = serializeErrorChain(error);
    }).not.toThrow();
    expect(result).toMatchObject({ message: "outer", cause: expect.any(String) });
  });

  it("lỗi gốc = Object.create(null) ⇒ không ném, trả chuỗi cố định", () => {
    expect(() => serializeErrorChain(Object.create(null))).not.toThrow();
    expect(serializeErrorChain(Object.create(null))).toEqual(expect.any(String));
  });

  it("cause có toString ném ⇒ không ném", () => {
    const cause = {
      toString() {
        throw new Error("toString boom");
      },
    };
    expect(() => serializeErrorChain(new Error("outer", { cause }))).not.toThrow();
  });

  it("cause có Symbol.toPrimitive ném ⇒ không ném", () => {
    const cause = {
      [Symbol.toPrimitive]() {
        throw new Error("toPrimitive boom");
      },
    };
    expect(() => serializeErrorChain(new Error("outer", { cause }))).not.toThrow();
  });

  it("getter message / cause / code / name ném ⇒ không ném, các trường đọc được vẫn giữ", () => {
    const badMessage = throwingGetter(new Error("x"), "message");
    const badCause = throwingGetter(new Error("still readable"), "cause");
    const badCode = throwingGetter(new Error("code getter"), "code");
    const badName = throwingGetter(new Error("name getter"), "name");

    for (const error of [badMessage, badCause, badCode, badName]) {
      expect(() => serializeErrorChain(error)).not.toThrow();
    }
    expect(serializeErrorChain(badCause)).toMatchObject({ message: "still readable" });
  });

  it("Proxy có bẫy getPrototypeOf ném (instanceof ném) ⇒ không ném", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("getPrototypeOf boom");
        },
      },
    );
    expect(() => serializeErrorChain(hostile)).not.toThrow();
    expect(() => serializeErrorChain(new Error("outer", { cause: hostile }))).not.toThrow();
  });

  it("cause tự tham chiếu ⇒ dấu vòng, không đệ quy", () => {
    const self = new Error("self");
    self.cause = self;

    expect(serializeErrorChain(self)).toEqual({
      name: "Error",
      message: "self",
      code: undefined,
      cause: "[cause cycle]",
    });
  });

  it("cause vòng hai nút A → B → A ⇒ dấu vòng ở lần gặp lại đầu tiên", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;

    expect(serializeErrorChain(a)).toEqual({
      name: "Error",
      message: "a",
      code: undefined,
      cause: { name: "Error", message: "b", code: undefined, cause: "[cause cycle]" },
    });
  });

  it("trường name/message không phải chuỗi được ép thành chuỗi an toàn (object log in được)", () => {
    const error = new Error("x");
    Object.defineProperty(error, "message", { value: Object.create(null) });

    const result = serializeErrorChain(error) as { message: unknown };
    expect(typeof result.message).toBe("string");
  });
});

describe("safeErrorStack — KHÔNG BAO GIỜ ném", () => {
  it("Error thường ⇒ trả đúng stack chuỗi", () => {
    const error = new Error("x");
    expect(safeErrorStack(error)).toBe(error.stack);
  });

  it("không phải Error ⇒ undefined", () => {
    expect(safeErrorStack("boom")).toBeUndefined();
    expect(safeErrorStack(Object.create(null))).toBeUndefined();
  });

  it("getter stack ném ⇒ undefined, không ném", () => {
    const error = throwingGetter(new Error("x"), "stack");
    expect(() => safeErrorStack(error)).not.toThrow();
    expect(safeErrorStack(error)).toBeUndefined();
  });

  it("Proxy có getPrototypeOf ném ⇒ undefined, không ném", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("getPrototypeOf boom");
        },
      },
    );
    expect(() => safeErrorStack(hostile)).not.toThrow();
    expect(safeErrorStack(hostile)).toBeUndefined();
  });
});
