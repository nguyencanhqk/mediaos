import { ConflictException, HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { mappedWrite } from "./payroll-pg-write.util";

/**
 * S15-PAYROLL-BE-4B (plan BE-4 §11b, security L6 + MEDIUM-2 gốc) — MỘT wrapper cho mọi câu ghi track C.
 * `DrizzleQueryError.message` = «Failed query: … params: [...]» — với `payroll_advances` thì params CHỞ `amount`.
 * Khuôn cũ `throw mapPayrollPgError(err) ?? err` ném lại nguyên lỗi drizzle ⇒ `AllExceptionsFilter` log `stack` 5xx
 * mang số tiền. Ở đây: lỗi có map ⇒ HttpException đi thẳng; không map ⇒ `Error` MỚI chỉ mang code · constraint · tag,
 * KHÔNG `cause`, KHÔNG params.
 */
const AMOUNT = "2500000";
const QUERY_MSG = `Failed query: insert into payroll_advances (…) values (…) params: ["u1", ${AMOUNT}, "2028-07"]`;

/** Hình dạng drizzle: lớp ngoài mang message câu lệnh; `cause` = lỗi node-postgres (code · constraint · message tag). */
function drizzleErr(code: string, opts: { constraint?: string; message?: string } = {}): Error {
  const cause = Object.assign(new Error(opts.message ?? "violation"), {
    code,
    constraint: opts.constraint,
  });
  return Object.assign(new Error(QUERY_MSG), { cause });
}

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (e: unknown) => e,
  );
}

describe("S15-PAYROLL-BE-4B · mappedWrite — lỗi PG không map ⇒ Error MỚI sạch, có map ⇒ HttpException", () => {
  it("thành công ⇒ trả nguyên giá trị", async () => {
    await expect(mappedWrite("payroll_advances", async () => ({ id: "x" }))).resolves.toEqual({
      id: "x",
    });
  });

  it("22003 (numeric out of range — amount tràn, KHÔNG map) ⇒ Error mới: nhãn bảng + code + constraint, KHÔNG số tiền, KHÔNG cause", async () => {
    const err = (await caught(() =>
      mappedWrite("payroll_advances", () =>
        Promise.reject(drizzleErr("22003", { constraint: "payroll_advances_amount_check" })),
      ),
    )) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(HttpException);
    expect(err.message).toContain("payroll_advances write failed");
    expect(err.message).toContain("code=22003");
    expect(err.message).toContain("constraint=payroll_advances_amount_check");
    expect(err.message).not.toContain(AMOUNT);
    expect(err.stack ?? "").not.toContain(AMOUNT);
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });

  it("23514 trigger với tag KHÔNG map ⇒ Error mới mang `tag=<trigger>:<tag>` (bóc từ message node), không số tiền", async () => {
    const err = (await caught(() =>
      mappedWrite("payroll_advances", () =>
        Promise.reject(
          drizzleErr("23514", {
            message: `payroll_advance_freeze_guard:weird-tag: amount=${AMOUNT}`,
          }),
        ),
      ),
    )) as Error;
    expect(err).not.toBeInstanceOf(HttpException);
    expect(err.message).toContain("tag=payroll_advance_freeze_guard:weird-tag");
    expect(err.message).not.toContain(AMOUNT);
  });

  it("23505 constraint đã map ⇒ HttpException của mapPayrollPgError đi thẳng (409, kind giữ nguyên)", async () => {
    const err = await caught(() =>
      mappedWrite("payroll_payment_batches", () =>
        Promise.reject(
          drizzleErr("23505", { constraint: "payroll_payment_batches_company_code_uq" }),
        ),
      ),
    );
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as {
      details: Array<{ field: string; message: string }>;
    };
    expect(body.details.find((d) => d.field === "kind")?.message).toBe("batch-code-exists");
  });

  it("lỗi KHÔNG phải PG (không code) mà message chở số ⇒ vẫn Error mới code=unknown, không lộ message gốc", async () => {
    const err = (await caught(() =>
      mappedWrite("payroll_advances", () => Promise.reject(new Error(QUERY_MSG))),
    )) as Error;
    expect(err.message).toContain("code=unknown");
    expect(err.message).not.toContain(AMOUNT);
  });
});
