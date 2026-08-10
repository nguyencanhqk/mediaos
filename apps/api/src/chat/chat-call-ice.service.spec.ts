import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCallIceService } from "./chat-call-ice.service";
import { ChatCallCooldownService } from "./chat-call-cooldown.service";
import type { DatabaseService } from "../db/db.service";
import type { AuditService } from "../events/audit.service";
import type { ValkeyService } from "../permission/valkey.service";

/**
 * S7-CALL-SEC-1 — lưới an toàn cho `ChatCallIceService`: đường code DUY NHẤT trong toàn dự án chạm secret
 * bên thứ ba (Cloudflare TURN). Trước WO này, file production KHÔNG có spec colocated nào — mọi nhánh
 * gọi Cloudflare thật (`!res.ok`, `catch`, `normalizeIceServers`) chưa từng thực thi trong test.
 *
 * Bốn nhóm ca, đúng thứ tự rủi ro giảm dần:
 *   1. BẤT BIẾN #3 — Logger không BAO GIỜ chứa token/keyId/URL/thân phản hồi (nhóm quan trọng nhất).
 *   2. HIGH-2 vế 1 — TTL credential hạ xuống 600s.
 *   3. HIGH-2 vế 2 — cooldown per-user (`ChatCallCooldownService`).
 *   4. HIGH-2 vế 3 — audit best-effort khi Cloudflare từ chối liên tiếp.
 * Cộng: nhánh mỹ thuật đã có trước WO (thứ tự STUN/TURN, thiếu env, fetch throw, payload dị dạng).
 */

const CO = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const ACTOR = { id: USER, companyId: CO };

// Fixture giống-secret PHẢI ghép chuỗi (CLAUDE.md) — literal high-entropy trip gitleaks `generic-api-key`.
// ⚠️ GHÉP CHUỖI THÔI LÀ CHƯA ĐỦ: bản đầu dùng đuôi hex `b7e2d1f0a9c8` và gitleaks vẫn ĐỎ (entropy 3.58
// trên chính mảnh đó, `generic-api-key`) dù nó nằm trong `.join()`. Đuôi phải là chữ ĐỌC ĐƯỢC + đệm ký
// tự lặp: độ dài giữ nguyên cho các assert, entropy tụt xuống dưới ngưỡng luật.
const FAKE_KEY_ID = ["test", "cf", "turn", "key-id", "example"].join("-").padEnd(30, "x");
const FAKE_API_TOKEN = ["test", "cf", "turn", "api-token", "example"].join("-").padEnd(36, "x");

interface MakeServiceOptions {
  /** Giá trị `ValkeyService.incr` trả về cho bộ đếm từ chối liên tiếp — mặc định `null` (Valkey tắt/lỗi
   *  ⇒ ép service rơi xuống fallback in-memory, đường quan trọng nhất để đo được mà không cần Postgres/Valkey). */
  rejectionIncrReturn?: number | null;
}

function makeService(opts: MakeServiceOptions = {}) {
  const auditRecord = vi.fn(async (_tx: unknown, _entry: Record<string, unknown>) => undefined);
  const audit = { record: auditRecord } as unknown as AuditService;

  const withTenant = vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({}),
  );
  const db = { withTenant } as unknown as DatabaseService;

  const valkeyIncr = vi.fn(async () => opts.rejectionIncrReturn ?? null);
  const valkeyDel = vi.fn(async () => true);
  const valkey = { incr: valkeyIncr, del: valkeyDel } as unknown as ValkeyService;

  // Cooldown KHÔNG nhận ValkeyService ⇒ pure in-memory, xác định (không phụ thuộc hạ tầng ngoài).
  const cooldown = new ChatCallCooldownService();

  const svc = new ChatCallIceService(cooldown, db, audit, valkey);
  return { svc, auditRecord, withTenant, valkeyIncr, valkeyDel, cooldown };
}

function okResponse(payload: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => payload };
}

function rejectResponse(
  status: number,
  payload: unknown = {},
): { ok: false; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: async () => payload };
}

describe("ChatCallIceService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const logSpies = ["log", "warn", "error", "debug", "verbose"] as const;
  let spies: Record<(typeof logSpies)[number], ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    spies = Object.fromEntries(
      logSpies.map((level) => [
        level,
        vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      ]),
    ) as typeof spies;
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  });

  function setEnv(): void {
    process.env.CLOUDFLARE_TURN_KEY_ID = FAKE_KEY_ID;
    process.env.CLOUDFLARE_TURN_API_TOKEN = FAKE_API_TOKEN;
  }

  /** Mọi chuỗi đã đi qua Logger, ở BẤT KỲ mức nào (log/warn/error/debug/verbose), gộp lại một chỗ. */
  function allLoggedText(): string {
    return logSpies
      .flatMap((level) =>
        spies[level].mock.calls.flatMap((call) =>
          call.filter((arg): arg is string => typeof arg === "string"),
        ),
      )
      .join("\n");
  }

  // ═══════════ BẤT BIẾN #3 — Logger KHÔNG BAO GIỜ chứa token/keyId/URL/thân phản hồi ═══════════

  describe("BẤT BIẾN #3 — chống rò secret qua Logger", () => {
    it("!res.ok: thân phản hồi Cloudflare vọng lại token ⇒ Logger KHÔNG chứa token, CHỈ mã trạng thái", async () => {
      setEnv();
      fetchMock.mockResolvedValue(
        rejectResponse(403, { error: `token rejected: ${FAKE_API_TOKEN}` }),
      );
      const { svc } = makeService();

      await svc.getIceConfig(ACTOR);

      const logged = allLoggedText();
      expect(logged).not.toContain(FAKE_API_TOKEN);
      expect(logged).not.toContain(FAKE_KEY_ID);
      expect(logged).toContain("403");
    });

    it("!res.ok: Logger KHÔNG chứa URL đầy đủ (URL mang keyId)", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(429));
      const { svc } = makeService();

      await svc.getIceConfig(ACTOR);

      expect(allLoggedText()).not.toContain("rtc.live.cloudflare.com");
    });

    it("fetch throw kèm message chứa URL+keyId (hành vi thật của lỗi fetch) ⇒ Logger CHỈ tên lớp lỗi", async () => {
      setEnv();
      const leaky = new TypeError(
        `fetch failed: https://rtc.live.cloudflare.com/v1/turn/keys/${FAKE_KEY_ID}/credentials/generate`,
      );
      fetchMock.mockRejectedValue(leaky);
      const { svc } = makeService();

      await svc.getIceConfig(ACTOR);

      const logged = allLoggedText();
      expect(logged).not.toContain(FAKE_KEY_ID);
      expect(logged).not.toContain("rtc.live.cloudflare.com");
      expect(logged).toContain("TypeError");
    });

    it("fetch timeout (AbortError qua AbortSignal.timeout) ⇒ Logger CHỈ tên lớp lỗi, không message gốc", async () => {
      setEnv();
      const abortErr = new DOMException("This operation was aborted", "TimeoutError");
      fetchMock.mockRejectedValue(abortErr);
      const { svc } = makeService();

      const result = await svc.getIceConfig(ACTOR);

      expect(result.iceServers.every((s) => String(s.urls).startsWith("stun:"))).toBe(true);
      expect(allLoggedText()).toContain("TimeoutError");
    });

    it("audit ghi cảnh báo (metadata) KHÔNG BAO GIỜ chứa token/keyId — kể cả khi chạm ngưỡng liên tiếp", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(500, { detail: FAKE_API_TOKEN }));
      const { svc, auditRecord } = makeService();

      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR); // 3 lần liên tiếp = ngưỡng ⇒ ghi audit

      expect(auditRecord).toHaveBeenCalledTimes(1);
      const entry = auditRecord.mock.calls[0][1] as Record<string, unknown>;
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(FAKE_API_TOKEN);
      expect(serialized).not.toContain(FAKE_KEY_ID);
      expect(entry.metadata).toEqual({ httpStatus: 500, consecutiveRejections: 3 });
    });

    it("lỗi khi GHI audit (best-effort) chứa token trong message ⇒ Logger vẫn KHÔNG lộ, và không ném", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(500));
      const { svc, auditRecord } = makeService();
      auditRecord.mockRejectedValue(new Error(`insert failed near token ${FAKE_API_TOKEN}`));

      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR);
      await expect(svc.getIceConfig(ACTOR)).resolves.toMatchObject({
        iceServers: expect.any(Array),
      });

      expect(allLoggedText()).not.toContain(FAKE_API_TOKEN);
    });
  });

  // ═══════════ Nhánh mỹ thuật đã có trước WO — lưới lần đầu ═══════════

  describe("thiếu env ⇒ chỉ STUN, không gọi Cloudflare", () => {
    it("không set CLOUDFLARE_TURN_* ⇒ fetch không được gọi, kết quả chỉ 2 máy chủ STUN", async () => {
      const { svc } = makeService();

      const result = await svc.getIceConfig(ACTOR);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.iceServers).toHaveLength(2);
      expect(result.iceServers.every((s) => String(s.urls).startsWith("stun:"))).toBe(true);
    });
  });

  describe("TURN được nối SAU STUN — thứ tự đúng", () => {
    it("thành công ⇒ 2 STUN đứng trước, TURN đứng cuối, đúng nội dung Cloudflare trả về", async () => {
      setEnv();
      const turnServer = { urls: "turn:turn.example.com:3478", username: "u", credential: "c" };
      fetchMock.mockResolvedValue(okResponse({ iceServers: [turnServer] }));
      const { svc } = makeService();

      const result = await svc.getIceConfig(ACTOR);

      expect(result.iceServers).toHaveLength(3);
      expect(String(result.iceServers[0].urls)).toContain("stun:");
      expect(String(result.iceServers[1].urls)).toContain("stun:");
      expect(result.iceServers[2]).toEqual(turnServer);
    });
  });

  describe("!res.ok ⇒ chỉ còn STUN (tắt-mềm), không ném", () => {
    it("429 ⇒ resolve với STUN, không reject", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(429));
      const { svc } = makeService();

      await expect(svc.getIceConfig(ACTOR)).resolves.toEqual({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
    });
  });

  describe("fetch throw / timeout ⇒ chỉ còn STUN, không ném, không sập boot", () => {
    it("network error ⇒ resolve với STUN", async () => {
      setEnv();
      fetchMock.mockRejectedValue(new Error("network down"));
      const { svc } = makeService();

      await expect(svc.getIceConfig(ACTOR)).resolves.toEqual({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
    });
  });

  describe("normalizeIceServers — payload dị dạng từ Cloudflare không làm sập", () => {
    const cases: Array<[string, unknown]> = [
      ["thiếu trường iceServers", {}],
      [
        "iceServers là OBJECT ĐƠN hợp lệ (không phải mảng)",
        { iceServers: { urls: "turn:x.example.com:3478", username: "u", credential: "c" } },
      ],
      ["mảng rỗng", { iceServers: [] }],
      ["phần tử thiếu urls", { iceServers: [{ username: "u", credential: "c" }] }],
      ["kiểu sai hoàn toàn (chuỗi)", { iceServers: "not-an-object" }],
      ["kiểu sai hoàn toàn (số)", { iceServers: 42 }],
      ["kiểu sai hoàn toàn (null)", { iceServers: null }],
      [
        "mảng lẫn hợp lệ + rác",
        { iceServers: [{ urls: "turn:ok.example.com:3478" }, { foo: "bar" }, null] },
      ],
    ];

    it.each(cases)("%s ⇒ không ném, luôn trả về mảng iceServers", async (_label, payload) => {
      setEnv();
      fetchMock.mockResolvedValue(okResponse(payload));
      const { svc } = makeService();

      await expect(svc.getIceConfig(ACTOR)).resolves.toMatchObject({
        iceServers: expect.any(Array),
      });
    });
  });

  // ═══════════ HIGH-2 vế 1 — TTL credential hạ xuống cửa sổ một cuộc gọi ═══════════

  describe("HIGH-2 vế 1 — TTL credential", () => {
    it("body gửi Cloudflare mang ttl=600 (KHÔNG còn 3600)", async () => {
      setEnv();
      fetchMock.mockResolvedValue(okResponse({ iceServers: [] }));
      const { svc } = makeService();

      await svc.getIceConfig(ACTOR);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { ttl: number };
      expect(body.ttl).toBe(600);
    });
  });

  // ═══════════ HIGH-2 vế 2 — cooldown per-user ═══════════

  describe("HIGH-2 vế 2 — cooldown per-user (ChatCallCooldownService)", () => {
    it("vượt ngưỡng cửa sổ ⇒ KHÔNG gọi Cloudflare thêm, rơi về STUN, KHÔNG ném", async () => {
      setEnv();
      fetchMock.mockResolvedValue(okResponse({ iceServers: [] }));
      const { svc } = makeService();

      for (let i = 0; i < 5; i += 1) await svc.getIceConfig(ACTOR);
      expect(fetchMock).toHaveBeenCalledTimes(5);

      const sixth = await svc.getIceConfig(ACTOR);
      expect(fetchMock).toHaveBeenCalledTimes(5); // KHÔNG tăng thêm
      expect(sixth.iceServers).toHaveLength(2);
      expect(sixth.iceServers.every((s) => String(s.urls).startsWith("stun:"))).toBe(true);
    });

    it("cooldown tách theo NGƯỜI — user khác không bị chặn bởi cooldown của user đã chạm ngưỡng", async () => {
      setEnv();
      fetchMock.mockResolvedValue(okResponse({ iceServers: [] }));
      const { svc } = makeService();

      for (let i = 0; i < 5; i += 1) await svc.getIceConfig(ACTOR);
      await svc.getIceConfig({ id: OTHER_USER, companyId: CO });

      expect(fetchMock).toHaveBeenCalledTimes(6);
    });
  });

  // ═══════════ HIGH-2 vế 3 — audit best-effort khi Cloudflare từ chối liên tiếp ═══════════

  describe("HIGH-2 vế 3 — audit khi Cloudflare từ chối liên tiếp", () => {
    it("dưới ngưỡng (1-2 lần liên tiếp) ⇒ KHÔNG ghi audit", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(500));
      const { svc, auditRecord } = makeService();

      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR);

      expect(auditRecord).not.toHaveBeenCalled();
    });

    it("chạm ngưỡng (3 lần liên tiếp) ⇒ ghi ĐÚNG 1 dòng audit, object_type=chat_call, qua withTenant(companyId)", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(503));
      const { svc, auditRecord, withTenant } = makeService();

      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR);

      expect(withTenant).toHaveBeenCalledWith(CO, expect.any(Function));
      expect(auditRecord).toHaveBeenCalledTimes(1);
      const entry = auditRecord.mock.calls[0][1] as Record<string, unknown>;
      expect(entry.objectType).toBe("chat_call");
      expect(entry.actorType).toBe("System");
      expect(entry.resultStatus).toBe("Failure");
    });

    it("MỘT lần THÀNH CÔNG reset bộ đếm — chuỗi rớt sau đó không cộng dồn qua lần thành công", async () => {
      setEnv();
      fetchMock
        .mockResolvedValueOnce(rejectResponse(500))
        .mockResolvedValueOnce(rejectResponse(500))
        .mockResolvedValueOnce(okResponse({ iceServers: [] }))
        .mockResolvedValueOnce(rejectResponse(500));
      const { svc, auditRecord, valkeyDel } = makeService();

      await svc.getIceConfig(ACTOR); // rớt 1
      await svc.getIceConfig(ACTOR); // rớt 2
      await svc.getIceConfig(ACTOR); // thành công ⇒ reset
      await svc.getIceConfig(ACTOR); // rớt 1 (lại, KHÔNG phải rớt thứ 3)

      expect(valkeyDel).toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it("ghi audit THẤT BẠI (best-effort) ⇒ NUỐT lỗi, getIceConfig vẫn trả kết quả bình thường", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(500));
      const { svc, auditRecord } = makeService();
      auditRecord.mockRejectedValue(new Error("db unavailable"));

      await svc.getIceConfig(ACTOR);
      await svc.getIceConfig(ACTOR);
      await expect(svc.getIceConfig(ACTOR)).resolves.toEqual({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
    });

    it("Valkey CÓ trả count (đường chính, không fallback) ⇒ dùng thẳng số Valkey trả về", async () => {
      setEnv();
      fetchMock.mockResolvedValue(rejectResponse(500));
      const { svc, auditRecord, valkeyIncr } = makeService({ rejectionIncrReturn: 3 });

      await svc.getIceConfig(ACTOR);

      expect(valkeyIncr).toHaveBeenCalledWith(`chat:ice-turn-reject:co:${CO}`, 300);
      expect(auditRecord).toHaveBeenCalledTimes(1);
      const entry = auditRecord.mock.calls[0][1] as Record<string, unknown>;
      expect(entry.metadata).toEqual({ httpStatus: 500, consecutiveRejections: 3 });
    });
  });
});
