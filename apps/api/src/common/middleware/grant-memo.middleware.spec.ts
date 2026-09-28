import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { GrantSnapshotMemo } from "../../permission/grant-snapshot-memo";
import { grantMemoMiddleware } from "./grant-memo.middleware";

/** S16-SOCIAL-PERMMEMO-1 — middleware mở ngữ cảnh memo quanh `next()` (DECISIONS-15). */
describe("grantMemoMiddleware", () => {
  const CO = "11111111-1111-1111-1111-111111111111";
  const U = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("phần còn lại của request (next) chạy TRONG ngữ cảnh memo ⇒ 2 lượt đọc = 1 lượt DB", async () => {
    const memo = new GrantSnapshotMemo();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [];
    };
    let downstream: Promise<void> = Promise.resolve();
    const next = (() => {
      downstream = (async () => {
        await memo.read(CO, U, load);
        await memo.read(CO, U, load);
      })();
    }) as NextFunction;

    grantMemoMiddleware({} as Request, {} as Response, next);
    await downstream;

    expect(loads, "next() PHẢI chạy trong ngữ cảnh memo của middleware").toBe(1);
  });

  it("mỗi lượt middleware = một ngữ cảnh MỚI (không xuyên request)", async () => {
    const memo = new GrantSnapshotMemo();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [];
    };
    for (let i = 0; i < 2; i += 1) {
      let downstream: Promise<unknown> = Promise.resolve();
      grantMemoMiddleware(
        {} as Request,
        {} as Response,
        (() => {
          downstream = memo.read(CO, U, load);
        }) as NextFunction,
      );
      await downstream;
    }
    expect(loads).toBe(2);
  });
});
