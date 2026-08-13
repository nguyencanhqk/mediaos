import { describe, expect, it } from "vitest";
import { getRequestId, runWithRequestId } from "./request-context";

describe("request-context (AsyncLocalStorage)", () => {
  it("getRequestId() trả undefined ngoài mọi context", () => {
    expect(getRequestId()).toBeUndefined();
  });

  it("getRequestId() trả đúng id TRONG runWithRequestId", () => {
    runWithRequestId("rid-1", () => {
      expect(getRequestId()).toBe("rid-1");
    });
  });

  it("context KHÔNG rò ra ngoài sau khi runWithRequestId kết thúc", () => {
    runWithRequestId("rid-2", () => {
      /* no-op */
    });
    expect(getRequestId()).toBeUndefined();
  });

  it("context xuyên qua await bên trong callback async", async () => {
    await runWithRequestId("rid-async", async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getRequestId()).toBe("rid-async");
    });
  });

  it("hai lần gọi lồng nhau — context TRONG dùng id của chính nó, quay lại NGOÀI đúng id ngoài", () => {
    runWithRequestId("outer", () => {
      expect(getRequestId()).toBe("outer");
      runWithRequestId("inner", () => {
        expect(getRequestId()).toBe("inner");
      });
      expect(getRequestId()).toBe("outer");
    });
  });
});
