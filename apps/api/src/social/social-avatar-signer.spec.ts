/**
 * S16-SOCIAL-AVATARPRESIGN-1 — unit của `SocialAvatarSigner` (plan §4.1 · §5 «Unit»).
 *
 * Signer là điểm ký DUY NHẤT của SOCIAL: mọi `avatarUrl` lên DTO đi qua `urlOf(ref)`. Các ca ở đây khoá
 * ba luật mà int-spec chỉ thấy gián tiếp:
 *   • khoá kết quả theo CẶP `(employeeId, avatarRaw)` của CHÍNH ref — ref đã che (raw null) không mượn
 *     chữ ký của ref khác cùng người (F1 · K1);
 *   • D2-b — chỉ fileId (UUID) được đưa đi ký; mọi URL/scheme lạ ⇒ initials;
 *   • D10 — `signTx` KHÔNG nuốt lỗi; chỉ `signInSavepointTx` nuốt, và chỉ bên trong `tx.transaction`.
 */
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import type {
  AvatarPresignService,
  AvatarSubject,
} from "../foundation/files/avatar-presign.service";
import {
  NO_AVATARS,
  SocialAvatarSigner,
  kudosRecipientDto,
  type SocialAvatarRef,
} from "./social-avatar-signer";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const EMP_X = "22222222-2222-4222-8222-222222222222";
const EMP_Y = "33333333-3333-4333-8333-333333333333";
const FILE_1 = "44444444-4444-4444-8444-444444444444";
const FILE_2 = "55555555-5555-4555-8555-555555555555";
const SIGNED = "http://minio.local/avatars/x.png?X-Amz-Signature=abc";

type Resolve = (
  companyId: string,
  subjects: AvatarSubject[],
  callerTx?: TenantTx,
) => Promise<Map<string, string>>;

function makeSigner(impl?: Resolve) {
  const resolveEmployeeAvatars = vi.fn<Resolve>(
    impl ??
      (async (_c, subjects) =>
        new Map(subjects.map((s) => [s.employeeId, `${SIGNED}-${s.employeeId}`]))),
  );
  const presign = { resolveEmployeeAvatars } as unknown as AvatarPresignService;
  return { signer: new SocialAvatarSigner(presign), resolveEmployeeAvatars };
}

/** tx giả — `transaction(cb)` gọi cb với một `sp` RIÊNG để ca D10 phân biệt được tx cha với SAVEPOINT. */
function fakeTx() {
  const sp = { __kind: "savepoint" } as unknown as TenantTx;
  const transaction = vi.fn(async (cb: (s: TenantTx) => Promise<unknown>) => cb(sp));
  const tx = { __kind: "parent", transaction } as unknown as TenantTx;
  return { tx, sp, transaction };
}

const ref = (employeeId: string | null, avatarRaw: string | null): SocialAvatarRef => ({
  employeeId,
  avatarRaw,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SocialAvatarSigner.signTx — chọn subject", () => {
  it("refs rỗng ⇒ KHÔNG gọi dịch vụ ký (0 câu cổng) và urlOf luôn null", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, []);
    expect(resolveEmployeeAvatars).not.toHaveBeenCalled();
    expect(out.urlOf(ref(EMP_X, FILE_1))).toBeNull();
  });

  it("employeeId null / avatarRaw null bị bỏ — không ref nào hợp lệ ⇒ không gọi dịch vụ", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx } = fakeTx();
    await signer.signTx(tx, COMPANY, [ref(null, FILE_1), ref(EMP_X, null)]);
    expect(resolveEmployeeAvatars).not.toHaveBeenCalled();
  });

  it("gọi dịch vụ với ĐÚNG 3 đối số (companyId, subjects, tx của caller) — không tự mở withTenant", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx } = fakeTx();
    await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1), ref(EMP_Y, FILE_2)]);
    expect(resolveEmployeeAvatars).toHaveBeenCalledTimes(1);
    expect(resolveEmployeeAvatars).toHaveBeenCalledWith(
      COMPANY,
      [
        { employeeId: EMP_X, avatarUrl: FILE_1 },
        { employeeId: EMP_Y, avatarUrl: FILE_2 },
      ],
      tx,
    );
  });

  it("trùng employeeId cùng raw ⇒ MỘT subject", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx } = fakeTx();
    await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1), ref(EMP_X, FILE_1)]);
    expect(resolveEmployeeAvatars.mock.calls[0]![1]).toEqual([
      { employeeId: EMP_X, avatarUrl: FILE_1 },
    ]);
  });

  it("D2-b — raw `https://…` / `javascript:` / `data:` KHÔNG vào subjects (chỉ fileId được ký)", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, [
      ref(EMP_X, "https://cdn.example/a.png"),
      ref(EMP_Y, "javascript:alert(1)"),
      ref("66666666-6666-4666-8666-666666666666", "data:image/png;base64,AAAA"),
    ]);
    expect(resolveEmployeeAvatars).not.toHaveBeenCalled();
    expect(out.urlOf(ref(EMP_X, "https://cdn.example/a.png"))).toBeNull();
  });
});

describe("SocialAvatarSigner — urlOf khoá theo CẶP (employeeId, avatarRaw)", () => {
  it("neo dương: ref đã ký ⇒ URL dịch vụ trả", async () => {
    const { signer } = makeSigner();
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1)]);
    expect(out.urlOf(ref(EMP_X, FILE_1))).toBe(`${SIGNED}-${EMP_X}`);
  });

  it("F1 — X ký qua ref {X, V} ⇒ ref đã che {X, null} VẪN null (không mượn chữ ký)", async () => {
    const { signer } = makeSigner();
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1), ref(EMP_X, null)]);
    expect(out.urlOf(ref(EMP_X, FILE_1)), "neo: ref không che được ký").toBe(`${SIGNED}-${EMP_X}`);
    expect(out.urlOf(ref(EMP_X, null))).toBeNull();
  });

  it("hai ref cùng người khác raw ⇒ subject CHỈ raw đầu tiên; ref raw kia ⇒ null", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1), ref(EMP_X, FILE_2)]);
    expect(resolveEmployeeAvatars.mock.calls[0]![1]).toEqual([
      { employeeId: EMP_X, avatarUrl: FILE_1 },
    ]);
    expect(out.urlOf(ref(EMP_X, FILE_1)), "neo").toBe(`${SIGNED}-${EMP_X}`);
    expect(out.urlOf(ref(EMP_X, FILE_2))).toBeNull();
  });

  it("dịch vụ không trả người đó (cặp không xác minh) ⇒ null", async () => {
    const { signer } = makeSigner(async () => new Map([[EMP_Y, SIGNED]]));
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1), ref(EMP_Y, FILE_2)]);
    expect(out.urlOf(ref(EMP_Y, FILE_2)), "neo").toBe(SIGNED);
    expect(out.urlOf(ref(EMP_X, FILE_1))).toBeNull();
  });

  it("lưới cuối — dịch vụ trả scheme lạ (`javascript:`) ⇒ null + logger.error", async () => {
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { signer } = makeSigner(
      async () =>
        new Map([
          [EMP_X, "javascript:alert(1)"],
          [EMP_Y, SIGNED],
        ]),
    );
    const { tx } = fakeTx();
    const out = await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1), ref(EMP_Y, FILE_2)]);
    expect(out.urlOf(ref(EMP_Y, FILE_2)), "neo").toBe(SIGNED);
    expect(out.urlOf(ref(EMP_X, FILE_1))).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(COMPANY);
  });

  it("NO_AVATARS ⇒ null với mọi ref", () => {
    expect(NO_AVATARS.urlOf(ref(EMP_X, FILE_1))).toBeNull();
  });
});

describe("D10 — lỗi câu cổng: signTx NÉM, signInSavepointTx nuốt TRONG SAVEPOINT", () => {
  it("signTx — dịch vụ ném ⇒ NÉM tiếp (không nuốt: tx không SAVEPOINT đã hỏng)", async () => {
    const { signer } = makeSigner(async () => {
      throw new Error("division by zero");
    });
    const { tx } = fakeTx();
    await expect(signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1)])).rejects.toThrow(
      "division by zero",
    );
  });

  it("signInSavepointTx — ký bên trong tx.transaction, dịch vụ nhận `sp` (không phải tx cha)", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx, sp, transaction } = fakeTx();
    const out = await signer.signInSavepointTx(tx, COMPANY, [ref(EMP_X, FILE_1)]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(resolveEmployeeAvatars.mock.calls[0]![2]).toBe(sp);
    expect(out.urlOf(ref(EMP_X, FILE_1))).toBe(`${SIGNED}-${EMP_X}`);
  });

  it("signInSavepointTx — dịch vụ ném ⇒ NO_AVATARS + logger.warn có companyId", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { signer } = makeSigner(async () => {
      throw Object.assign(new Error("division by zero"), { code: "22012" });
    });
    const { tx, transaction } = fakeTx();
    const out = await signer.signInSavepointTx(tx, COMPANY, [ref(EMP_X, FILE_1)]);
    expect(transaction, "neo: đã đi qua SAVEPOINT").toHaveBeenCalledTimes(1);
    expect(out.urlOf(ref(EMP_X, FILE_1))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(COMPANY);
    expect(String(warn.mock.calls[0]![0])).toContain("22012");
  });

  it("signInSavepointTx — log lấy lý do từ lỗi DRIVER, KHÔNG nhúng câu SQL + tham số bind của drizzle", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const pgErr = Object.assign(new Error("division by zero"), { code: "22012" });
    const { signer } = makeSigner(async () => {
      throw Object.assign(new Error(`Failed query: select 1/0\nparams: ${COMPANY},${FILE_1}`), {
        cause: pgErr,
      });
    });
    const { tx } = fakeTx();
    const out = await signer.signInSavepointTx(tx, COMPANY, [ref(EMP_X, FILE_1)]);
    expect(out.urlOf(ref(EMP_X, FILE_1)), "neo: nuốt trong SAVEPOINT").toBeNull();
    const msg = String(warn.mock.calls[0]![0]);
    expect(msg).toContain("22012");
    expect(msg).toContain("division by zero");
    expect(msg).not.toContain(FILE_1);
  });

  it("signInSavepointTx — không có fileId nào ⇒ KHÔNG mở SAVEPOINT (0 câu thêm)", async () => {
    const { signer, resolveEmployeeAvatars } = makeSigner();
    const { tx, transaction } = fakeTx();
    await signer.signInSavepointTx(tx, COMPANY, [ref(EMP_X, null), ref(EMP_Y, "https://x.test/a")]);
    expect(transaction).not.toHaveBeenCalled();
    expect(resolveEmployeeAvatars).not.toHaveBeenCalled();
  });
});

describe("kudosRecipientDto — MỘT luật người nhận cho thẻ + 047", () => {
  it("chép theo DANH SÁCH KHOÁ, avatar qua urlOf (cột thô không lên DTO)", async () => {
    const { signer } = makeSigner();
    const { tx } = fakeTx();
    const row = {
      kudosId: "77777777-7777-4777-8777-777777777777",
      employeeId: EMP_X,
      fullName: "Người Nhận",
      avatarRaw: FILE_1,
      isFormerEmployee: false,
      userId: "88888888-8888-4888-8888-888888888888",
    };
    const avatars = await signer.signTx(tx, COMPANY, [ref(EMP_X, FILE_1)]);
    expect(kudosRecipientDto(row, avatars)).toEqual({
      employeeId: EMP_X,
      fullName: "Người Nhận",
      avatarUrl: `${SIGNED}-${EMP_X}`,
      isFormerEmployee: false,
    });
    expect(kudosRecipientDto(row, NO_AVATARS).avatarUrl).toBeNull();
  });
});
