/**
 * S19-QA-FETESTNET-1 — thử NGƯỢC lưới chặn mạng: chứng minh lưới có răng, không chỉ "đang xanh".
 *
 * Kiểm bằng LOGIC THUẦN của lưới (`evaluateGuard`) + lưới thật đang cài ở `setup.ts` — không làm đỏ cả suite.
 */
import { apiFetch } from "@mediaos/web-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFetchNetGuard, evaluateGuard } from "./fetch-net-guard";

const verdict = (over: Partial<Parameters<typeof evaluateGuard>[0]> = {}) =>
  evaluateGuard({
    testFile: "x.spec.ts",
    testName: "ca",
    calls: [],
    currentFetch: undefined,
    isGuard: true,
    isDeclaredMock: false,
    ...over,
  });

describe("fetch-net-guard — logic phán quyết", () => {
  it("DENY: ca để lọt một lời gọi ⇒ ĐỎ, thông điệp nêu tệp, ca và URL", () => {
    const problems = verdict({ calls: [{ url: "http://localhost:3100/api/v1/probe" }] });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("x.spec.ts › ca");
    expect(problems[0]).toContain("http://localhost:3100/api/v1/probe");
    expect(problems[0]).toContain("KHÔNG nới lưới");
  });

  it("DENY: fetch không còn là lưới cũng không phải mock do spec khai ⇒ TỰ KIỂM đỏ", () => {
    const problems = verdict({ isGuard: false, isDeclaredMock: false });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("TỰ KIỂM HỎNG");
  });

  it("ALLOW: lưới nguyên vẹn không lời gọi ⇒ sạch", () => {
    expect(verdict()).toEqual([]);
  });

  it("ALLOW: spec tự khai fetch giả (mock) ⇒ sạch", () => {
    expect(verdict({ isGuard: false, isDeclaredMock: true })).toEqual([]);
  });
});

describe("fetch-net-guard — lưới thật (createFetchNetGuard)", () => {
  it("ghi sổ URL cả với chuỗi, URL lẫn Request, và luôn từ chối", async () => {
    const net = createFetchNetGuard();

    await expect(net.guard("http://a.test/1")).rejects.toThrow("mạng bị chặn");
    await expect(net.guard(new URL("http://a.test/2"))).rejects.toThrow();
    await expect(net.guard(new Request("http://a.test/3"))).rejects.toThrow();

    expect(net.calls().map((c) => c.url)).toEqual([
      "http://a.test/1",
      "http://a.test/2",
      "http://a.test/3",
    ]);
    expect(net.take()).toHaveLength(3);
    expect(net.calls()).toEqual([]);
  });

  it("DENY: lời gọi từ beforeAll/giữa ca vẫn nằm trong sổ cho tới khi rút, kèm nhãn ca lúc gọi (không bị xoá ở đầu ca)", async () => {
    let phase = "beforeAll-giả";
    const net = createFetchNetGuard(() => phase);
    await net.guard("http://a.test/early").catch(() => undefined);
    phase = "ca-sau";

    const drained = net.take();

    expect(drained).toEqual([{ url: "http://a.test/early", during: "beforeAll-giả" }]);
    expect(evaluateGuard({ testFile: "f", testName: "t", calls: drained, currentFetch: net.guard, isGuard: true, isDeclaredMock: false })[0]).toContain(
      "[lúc gọi: beforeAll-giả]",
    );
  });
});

describe("fetch-net-guard — lưới toàn cục do setup.ts cài", () => {
  it("fetch toàn cục LÀ lưới (gỡ dòng cài ở setup.ts ⇒ ca này đỏ)", () => {
    expect(String(globalThis.fetch)).toContain("mạng bị chặn");
  });

  it("apiFetch không mock ⇒ chạm fetch, bị từ chối và URL vào sổ (lưới riêng của ca, gỡ sau ca)", async () => {
    const net = createFetchNetGuard();
    vi.stubGlobal("fetch", net.guard);
    try {
      await expect(apiFetch("/probe-fetch-net-guard", z.unknown())).rejects.toBeDefined();
      expect(net.calls().map((c) => c.url)).toEqual([expect.stringContaining("/probe-fetch-net-guard")]);
      expect(evaluateGuard({ testFile: "f", testName: "t", calls: net.calls(), currentFetch: net.guard, isGuard: true, isDeclaredMock: false })[0]).toContain("probe-fetch-net-guard");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
