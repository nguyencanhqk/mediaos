import "reflect-metadata";
/**
 * S5-LMS-BE-3 (RED trước) — MeTrainingService: proxy tiến độ học own-scope.
 *
 * Khoá hành vi:
 *   - client tắt (thiếu env) → 503 ME-ERR-TRAINING-LMS-DISABLED (KHÔNG gọi LMS);
 *   - company ngoài phạm vi LMS (LMS_COMPANY_ID khai và lệch) → 503 (fail-closed, KHÔNG rò email tenant khác);
 *   - client throw (LMS chết/timeout) → 502 ME-ERR-TRAINING-LMS-UNAVAILABLE;
 *   - payload lệch hợp đồng (version≠1 / thiếu field) → 502 ME-ERR-TRAINING-CONTRACT-MISMATCH
 *     (KHÔNG forward object lệch ra controller);
 *   - LMS 404 → 200 { status:'no_account', progress:null } (fail-soft);
 *   - cache HIT trong TTL → KHÔNG gọi lại client; cache key CÓ companyId + userId ⇒ 2 actor độc lập;
 *   - email gửi sang LMS LUÔN là email của actor (chống IDOR ở tầng service).
 */
import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ME_ERROR_CODES } from "@mediaos/contracts";
import { MeTrainingService } from "./me-training.service";
import type { LmsProgressClient } from "../integrations/lms/lms-progress-client.service";
import type { ValkeyService } from "../permission/valkey.service";

const ACTOR_A = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
  email: "a@congty.test",
};
const ACTOR_B = {
  id: "33333333-3333-3333-3333-333333333333",
  companyId: ACTOR_A.companyId,
  email: "b@congty.test",
};

const ORIGINAL_ENV = { ...process.env };

function progressPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    generatedAt: "2026-07-23T10:00:00.000Z",
    user: { email: ACTOR_A.email, name: "A", active: true },
    summary: {
      courseCount: 1,
      completedCourses: 1,
      learningTimeSec: 60,
      lastActivityAt: "2026-07-20T03:00:00.000Z",
    },
    courses: [
      {
        slug: "c1",
        title: "Khoá 1",
        percent: 100,
        completed: 3,
        total: 3,
        learningTimeSec: 60,
        lastActivityAt: "2026-07-20T03:00:00.000Z",
      },
    ],
    coursesTruncated: false,
    exams: {
      submitted: 0,
      passed: 0,
      failed: 0,
      pendingGrading: 0,
      bestScore10: null,
      lastSubmittedAt: null,
      truncated: false,
    },
    quizzes: { submitted: 0, averagePercent: null, lastSubmittedAt: null },
    ...overrides,
  };
}

/** Valkey giả CÓ TRẠNG THÁI (Map) — chứng minh cache key thật sự phân tách theo actor. */
function fakeValkey() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return true;
    }),
  } as unknown as ValkeyService & { store: Map<string, string> };
}

function fakeClient(enabled = true) {
  return {
    isEnabled: vi.fn(() => enabled),
    fetchProgress: vi.fn(async () => ({ found: true as const, body: progressPayload() })),
  } as unknown as LmsProgressClient & {
    isEnabled: ReturnType<typeof vi.fn>;
    fetchProgress: ReturnType<typeof vi.fn>;
  };
}

describe("MeTrainingService", () => {
  beforeEach(() => {
    delete process.env.LMS_COMPANY_ID;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("client tắt → 503 ME-ERR-TRAINING-LMS-DISABLED, KHÔNG gọi LMS", async () => {
    const client = fakeClient(false);
    const svc = new MeTrainingService(client, fakeValkey());
    await expect(svc.getMyTraining(ACTOR_A)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.getMyTraining(ACTOR_A)).rejects.toMatchObject({
      response: { code: ME_ERROR_CODES.TRAINING_LMS_DISABLED },
    });
    expect(client.fetchProgress).not.toHaveBeenCalled();
  });

  it("LMS_COMPANY_ID khai và LỆCH company của actor → 503, KHÔNG gửi email sang LMS", async () => {
    process.env.LMS_COMPANY_ID = "99999999-9999-9999-9999-999999999999";
    const client = fakeClient();
    const svc = new MeTrainingService(client, fakeValkey());
    await expect(svc.getMyTraining(ACTOR_A)).rejects.toMatchObject({
      response: { code: ME_ERROR_CODES.TRAINING_LMS_DISABLED },
    });
    expect(client.fetchProgress).not.toHaveBeenCalled();
  });

  it("LMS_COMPANY_ID khai và KHỚP → đi tiếp bình thường", async () => {
    process.env.LMS_COMPANY_ID = ACTOR_A.companyId;
    const client = fakeClient();
    const svc = new MeTrainingService(client, fakeValkey());
    await expect(svc.getMyTraining(ACTOR_A)).resolves.toMatchObject({ status: "ok" });
  });

  it("actor KHÔNG có email (phiên PAT/API-key) → 403 tường minh, KHÔNG nổ TypeError 500", async () => {
    const client = fakeClient();
    const svc = new MeTrainingService(client, fakeValkey());
    const patActor = { id: ACTOR_A.id, companyId: ACTOR_A.companyId } as unknown as typeof ACTOR_A;
    await expect(svc.getMyTraining(patActor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.fetchProgress).not.toHaveBeenCalled();
  });

  it("happy — trả envelope ok + progress ĐÃ qua Zod; email gửi đi là email của ACTOR", async () => {
    const client = fakeClient();
    const svc = new MeTrainingService(client, fakeValkey());
    const res = await svc.getMyTraining(ACTOR_A);
    expect(res.status).toBe("ok");
    expect(res.progress?.version).toBe(1);
    expect(client.fetchProgress).toHaveBeenCalledWith(ACTOR_A.email);
  });

  it("field lạ trong payload LMS bị STRIP (không lọt ra response)", async () => {
    const client = fakeClient();
    client.fetchProgress.mockResolvedValue({
      found: true,
      body: progressPayload({ internalUserId: "u-1", passwordHash: "x" }),
    });
    const res = await new MeTrainingService(client, fakeValkey()).getMyTraining(ACTOR_A);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("internalUserId");
    expect(serialized).not.toContain("passwordHash");
  });

  it("client throw (LMS chết/timeout) → 502 ME-ERR-TRAINING-LMS-UNAVAILABLE", async () => {
    const client = fakeClient();
    client.fetchProgress.mockRejectedValue(new Error("LMS progress network error: aborted"));
    const svc = new MeTrainingService(client, fakeValkey());
    await expect(svc.getMyTraining(ACTOR_A)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(svc.getMyTraining(ACTOR_A)).rejects.toMatchObject({
      response: { code: ME_ERROR_CODES.TRAINING_LMS_UNAVAILABLE },
    });
  });

  it("version ≠ 1 → 502 ME-ERR-TRAINING-CONTRACT-MISMATCH", async () => {
    const client = fakeClient();
    client.fetchProgress.mockResolvedValue({ found: true, body: progressPayload({ version: 2 }) });
    await expect(
      new MeTrainingService(client, fakeValkey()).getMyTraining(ACTOR_A),
    ).rejects.toMatchObject({ response: { code: ME_ERROR_CODES.TRAINING_CONTRACT_MISMATCH } });
  });

  it("thiếu field bắt buộc → 502 contract-mismatch (KHÔNG forward object lệch)", async () => {
    const client = fakeClient();
    const { summary: _drop, ...broken } = progressPayload();
    client.fetchProgress.mockResolvedValue({ found: true, body: broken });
    await expect(
      new MeTrainingService(client, fakeValkey()).getMyTraining(ACTOR_A),
    ).rejects.toMatchObject({ response: { code: ME_ERROR_CODES.TRAINING_CONTRACT_MISMATCH } });
  });

  it("LMS 404 → 200 { status:'no_account', progress:null } (fail-soft, KHÔNG 502)", async () => {
    const client = fakeClient();
    client.fetchProgress.mockResolvedValue({ found: false });
    await expect(
      new MeTrainingService(client, fakeValkey()).getMyTraining(ACTOR_A),
    ).resolves.toEqual({ status: "no_account", progress: null });
  });

  describe("cache", () => {
    it("HIT trong TTL → KHÔNG gọi lại client (chống đụng trần rate-limit LMS)", async () => {
      const client = fakeClient();
      const valkey = fakeValkey();
      const svc = new MeTrainingService(client, valkey);
      const first = await svc.getMyTraining(ACTOR_A);
      const second = await svc.getMyTraining(ACTOR_A);
      expect(client.fetchProgress).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it("ghi cache có TTL ~60s và key CHỨA companyId + userId", async () => {
      const client = fakeClient();
      const valkey = fakeValkey();
      await new MeTrainingService(client, valkey).getMyTraining(ACTOR_A);
      const [key, , ttl] = (valkey.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        number,
      ];
      expect(key).toContain(ACTOR_A.companyId);
      expect(key).toContain(ACTOR_A.id);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120);
    });

    it("2 actor khác nhau → 2 entry cache độc lập, KHÔNG lẫn dữ liệu", async () => {
      const client = fakeClient();
      const valkey = fakeValkey();
      const svc = new MeTrainingService(client, valkey);
      client.fetchProgress.mockImplementation(async (email: string) => ({
        found: true,
        body: progressPayload({ user: { email, name: null, active: true } }),
      }));

      const a = await svc.getMyTraining(ACTOR_A);
      const b = await svc.getMyTraining(ACTOR_B);
      expect(a.progress?.user.email).toBe(ACTOR_A.email);
      expect(b.progress?.user.email).toBe(ACTOR_B.email);
      expect(client.fetchProgress).toHaveBeenCalledTimes(2);
      expect(valkey.store.size).toBe(2);

      // đọc lại: mỗi actor lấy đúng entry của mình từ cache
      expect((await svc.getMyTraining(ACTOR_A)).progress?.user.email).toBe(ACTOR_A.email);
      expect((await svc.getMyTraining(ACTOR_B)).progress?.user.email).toBe(ACTOR_B.email);
      expect(client.fetchProgress).toHaveBeenCalledTimes(2);
    });

    it("cache chứa dữ liệu HỎNG (shape cũ) → coi như MISS, gọi lại client (KHÔNG 502 vì cache)", async () => {
      const client = fakeClient();
      const valkey = fakeValkey();
      const svc = new MeTrainingService(client, valkey);
      await svc.getMyTraining(ACTOR_A);
      const key = [...valkey.store.keys()][0];
      valkey.store.set(key, JSON.stringify({ status: "ok", progress: { version: 2 } }));

      await expect(svc.getMyTraining(ACTOR_A)).resolves.toMatchObject({ status: "ok" });
      expect(client.fetchProgress).toHaveBeenCalledTimes(2);
    });

    it("cache KHÔNG lưu token/secret — chỉ DTO đã qua Zod", async () => {
      const client = fakeClient();
      const valkey = fakeValkey();
      await new MeTrainingService(client, valkey).getMyTraining(ACTOR_A);
      const cached = [...valkey.store.values()].join("|");
      expect(cached).not.toContain("Bearer");
      expect(cached).not.toContain("token");
      expect(JSON.parse([...valkey.store.values()][0]).status).toBe("ok");
    });

    it("Valkey down (get/set fail-open) → vẫn trả dữ liệu, không ném lỗi", async () => {
      const client = fakeClient();
      const valkey = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => false),
      } as unknown as ValkeyService;
      await expect(
        new MeTrainingService(client, valkey).getMyTraining(ACTOR_A),
      ).resolves.toMatchObject({ status: "ok" });
    });
  });
});
