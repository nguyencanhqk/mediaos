import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatPresenceService,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_SEC,
} from "./chat-presence.service";
import { ChatPresenceReaderService } from "./chat-presence-reader.service";
import type { RealtimeEmitterService } from "./realtime-emitter.service";
import type { ValkeyService } from "../permission/valkey.service";
import type { DatabaseService } from "../db/db.service";
import type { ChatRoomsRepository } from "../chat/chat-rooms.repository";

/**
 * S8-CHAT-UX-RT-1 — "đang online" (CHAT-DEC-017 · CHAT-FUNC-021).
 *
 * Kho Valkey GIẢ dưới đây là một `Map` DÙNG CHUNG, cố tình: đó là mô hình đúng của hiện trạng — cả bốn môi
 * trường trỏ CÙNG MỘT Valkey `redis://localhost:6379` và Valkey không có tiền tố kênh sẵn. Nhờ vậy ca test
 * A/B môi trường đo được ĐÚNG thứ cần đo (không gian khoá tách nhau), chứ không phải "hai Map khác nhau thì
 * đương nhiên không thấy nhau" — một tautology.
 */

interface FakeEntry {
  members: Set<string>;
  ttlSec: number | null;
}

/** Cài đặt tối thiểu của SADD/SREM/SCARD/DEL trên một kho chung, đủ đúng cho các bất biến đang đo. */
function makeFakeValkey(store: Map<string, FakeEntry>, enabled = true) {
  const svc = {
    isEnabled: () => enabled,
    sAddWithTtl: vi.fn(async (key: string, member: string, ttlSec: number) => {
      const entry = store.get(key) ?? { members: new Set<string>(), ttlSec: null };
      entry.members.add(member);
      entry.ttlSec = ttlSec;
      store.set(key, entry);
      return entry.members.size;
    }),
    sRemCount: vi.fn(async (key: string, member: string) => {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.members.delete(member);
      return entry.members.size;
    }),
    sCard: vi.fn(async (key: string) => store.get(key)?.members.size ?? 0),
    del: vi.fn(async (...keys: string[]) => {
      for (const k of keys) store.delete(k);
      return true;
    }),
  };
  return svc as unknown as ValkeyService & typeof svc;
}

function makeService(opts: {
  valkey: ReturnType<typeof makeFakeValkey>;
  peers?: string[];
  envScope?: string;
  peersImpl?: () => Promise<string[]>;
}) {
  const emitChatPresence = vi.fn();
  const emitter = { emitChatPresence } as unknown as RealtimeEmitterService;
  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;
  const listDirectPeerUserIds = vi.fn(opts.peersImpl ?? (async () => opts.peers ?? ["peer-1"]));
  const repo = { listDirectPeerUserIds } as unknown as ChatRoomsRepository;

  // S8-CHAT-UX-FE-3 — `presenceKey` + vế ĐỌC chuyển xuống leaf `ChatPresenceReaderService` (để
  // `ChatModule` dùng chung không gian khoá mà không tạo vòng module). Test dựng reader THẬT chứ không
  // giả lập: chính phép suy khoá là thứ ca A/B dưới đây phải chứng minh, giả lập nó là tự huỷ bài test.
  const reader = new ChatPresenceReaderService(opts.valkey);
  // Ép phạm vi môi trường cho ca A/B — hàm dựng đọc env THẬT của tiến trình test, mà ca này cần dựng HAI
  // phạm vi khác nhau trong cùng một tiến trình. Ép ở READER vì khoá giờ sinh ở đó.
  if (opts.envScope) {
    (reader as unknown as { envScope: string }).envScope = opts.envScope;
  }
  const svc = new ChatPresenceService(opts.valkey, emitter, db, repo, reader);
  return { svc, emitChatPresence, listDirectPeerUserIds, reader };
}

const CO = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("ChatPresenceService — không gian khoá theo MÔI TRƯỜNG (done_when 3)", () => {
  it("hai môi trường dùng CHUNG một Valkey vẫn KHÔNG thấy nhau", async () => {
    const shared = new Map<string, FakeEntry>();
    const prod = makeService({
      valkey: makeFakeValkey(shared),
      envScope: "production:mediaos",
    });
    const devOnline = makeService({
      valkey: makeFakeValkey(shared),
      envScope: "development:mediaos_dev",
    });

    await prod.svc.markOnline(CO, USER, "socket-prod");

    // Cùng công ty, cùng user, CÙNG kho Valkey — nhưng khác môi trường.
    expect(await prod.svc.getOnlineUserIds(CO, [USER])).toEqual([USER]);
    expect(await devOnline.svc.getOnlineUserIds(CO, [USER])).toEqual([]);

    // Và chứng minh phép tách nằm ở KHOÁ, không ở chỗ nào khác.
    expect(prod.svc.presenceKey(CO, USER)).not.toBe(devOnline.svc.presenceKey(CO, USER));
    expect([...shared.keys()]).toEqual([prod.svc.presenceKey(CO, USER)]);
  });

  it("🔒 hai CÔNG TY dùng chung một Valkey cũng KHÔNG thấy nhau (S8-CHAT-UX-QA-1 — cross-tenant presence)", async () => {
    // Vế công ty của cùng phép tách. Ca kề trên chứng minh {envScope} tách được hai MÔI TRƯỜNG; ca này
    // chứng minh {companyId} tách được hai TENANT — cùng một kho, cùng một userId.
    //
    // Vì sao phải có ca riêng: `presenceKey` chứa `companyId`, nhưng `getOnlineUserIds` nhận `companyId`
    // như một THAM SỐ. Một bản vá "tối ưu" đọc thẳng khoá theo userId (bỏ tenant khỏi khoá, hoặc đọc
    // SCAN theo hậu tố) sẽ vẫn đúng chính tả khoá ở ca kề trên mà rò chấm-online chéo công ty ở đây.
    const shared = new Map<string, FakeEntry>();
    const coA = makeService({ valkey: makeFakeValkey(shared), envScope: "production:mediaos" });
    const coB = makeService({ valkey: makeFakeValkey(shared), envScope: "production:mediaos" });
    const CO_B = "33333333-3333-4333-8333-333333333333";

    await coA.svc.markOnline(CO, USER, "socket-a");

    expect(await coA.svc.getOnlineUserIds(CO, [USER]), "đối chứng dương").toEqual([USER]);
    expect(await coB.svc.getOnlineUserIds(CO_B, [USER]), "công ty B KHÔNG thấy ai online").toEqual(
      [],
    );
    expect(coA.svc.presenceKey(CO, USER)).not.toBe(coB.svc.presenceKey(CO_B, USER));
  });

  it("khoá mang cả phạm vi môi trường lẫn công ty", () => {
    const { svc } = makeService({
      valkey: makeFakeValkey(new Map()),
      envScope: "production:mediaos",
    });
    expect(svc.presenceKey(CO, USER)).toBe(
      `chat:presence:production:mediaos:co:${CO}:user:${USER}`,
    );
  });
});

describe("ChatPresenceService — TTL (done_when 4: ngắt bẩn không để lại online vĩnh viễn)", () => {
  it("markOnline đặt TTL hữu hạn trên khoá", async () => {
    const store = new Map<string, FakeEntry>();
    const { svc } = makeService({ valkey: makeFakeValkey(store) });

    await svc.markOnline(CO, USER, "socket-a");

    const entry = store.get(svc.presenceKey(CO, USER));
    expect(entry?.ttlSec).toBe(PRESENCE_TTL_SEC);
    expect(entry?.ttlSec).toBeGreaterThan(0);
  });

  it("nhịp tim gia hạn TTL và PHẢI thưa hơn TTL để một tick lỡ không làm rớt trạng thái", async () => {
    // Biên an toàn: nhịp < TTL/2 nghĩa là lỡ 1 tick vẫn còn 1 tick nữa trước khi khoá hết hạn.
    expect(PRESENCE_HEARTBEAT_MS).toBeLessThan((PRESENCE_TTL_SEC / 2) * 1000);

    const valkey = makeFakeValkey(new Map());
    const { svc } = makeService({ valkey });
    await svc.markOnline(CO, USER, "socket-a");
    valkey.sAddWithTtl.mockClear();

    await svc.refreshLocal();

    expect(valkey.sAddWithTtl).toHaveBeenCalledWith(
      svc.presenceKey(CO, USER),
      "socket-a",
      PRESENCE_TTL_SEC,
    );
  });

  it("nhịp tim KHÔNG phát sự kiện — gia hạn không phải chuyển trạng thái", async () => {
    const { svc, emitChatPresence } = makeService({ valkey: makeFakeValkey(new Map()) });
    await svc.markOnline(CO, USER, "socket-a");
    emitChatPresence.mockClear();

    await svc.refreshLocal();

    expect(emitChatPresence).not.toHaveBeenCalled();
  });
});

describe("ChatPresenceService — chuyển trạng thái với NHIỀU socket", () => {
  it("hai tab của cùng một người ⇒ đúng MỘT sự kiện online; offline chỉ khi tab cuối đóng", async () => {
    const { svc, emitChatPresence } = makeService({ valkey: makeFakeValkey(new Map()) });

    await svc.markOnline(CO, USER, "tab-1");
    await svc.markOnline(CO, USER, "tab-2");
    expect(emitChatPresence).toHaveBeenCalledTimes(1);
    expect(emitChatPresence).toHaveBeenCalledWith(CO, { userId: USER, status: "online" }, [
      "peer-1",
    ]);

    // Đóng tab đầu: người dùng VẪN online ở tab kia — phát "offline" ở đây là báo sai.
    await svc.markOffline(CO, USER, "tab-1");
    expect(emitChatPresence).toHaveBeenCalledTimes(1);

    await svc.markOffline(CO, USER, "tab-2");
    expect(emitChatPresence).toHaveBeenCalledTimes(2);
    expect(emitChatPresence).toHaveBeenLastCalledWith(CO, { userId: USER, status: "offline" }, [
      "peer-1",
    ]);
  });

  it("socket cuối rời ⇒ khoá bị DỌN, không nằm lại chờ hết hạn", async () => {
    const store = new Map<string, FakeEntry>();
    const { svc } = makeService({ valkey: makeFakeValkey(store) });

    await svc.markOnline(CO, USER, "tab-1");
    await svc.markOffline(CO, USER, "tab-1");

    expect(store.has(svc.presenceKey(CO, USER))).toBe(false);
    expect(svc.localSocketCount()).toBe(0);
  });

  it("sổ socket cục bộ được dọn ở markOffline — không rò bộ nhớ theo số lần kết nối", async () => {
    const { svc } = makeService({ valkey: makeFakeValkey(new Map()) });

    for (let i = 0; i < 50; i++) await svc.markOnline(CO, USER, `s-${i}`);
    expect(svc.localSocketCount()).toBe(50);
    for (let i = 0; i < 50; i++) await svc.markOffline(CO, USER, `s-${i}`);

    expect(svc.localSocketCount()).toBe(0);
  });
});

describe("ChatPresenceService — socket CHƯA TỪNG online không được phát offline", () => {
  it("🔒 disconnect của socket trượt cổng quyền ⇒ 0 sự kiện (không có 'offline' ma)", async () => {
    const { svc, emitChatPresence } = makeService({ valkey: makeFakeValkey(new Map()) });

    // Kịch bản thật: user THIẾU cặp `view:chat-room` → `handleConnection` dừng ở bước (A), KHÔNG gọi
    // `markOnline`. Nhưng `handleDisconnect` chạy cho MỌI socket. Nếu `markOffline` không phân biệt
    // "chưa từng online", nó thấy SCARD=0 và phát `offline` — báo cho các peer DM một chuyển trạng thái
    // chưa bao giờ xảy ra, và làm đúng việc mà cổng quyền vừa từ chối.
    await svc.markOffline(CO, USER, "socket-chua-tung-online");

    expect(emitChatPresence).not.toHaveBeenCalled();
  });

  it("🔒 disconnect LẶP của cùng một socket chỉ phát offline MỘT lần", async () => {
    const { svc, emitChatPresence } = makeService({ valkey: makeFakeValkey(new Map()) });
    await svc.markOnline(CO, USER, "s1");
    emitChatPresence.mockClear();

    await svc.markOffline(CO, USER, "s1");
    await svc.markOffline(CO, USER, "s1");

    expect(emitChatPresence).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPresenceService — FAIL-SOFT (không bao giờ làm hỏng kết nối)", () => {
  it("Valkey lỗi ⇒ KHÔNG ném, KHÔNG phát sự kiện (thà không biết còn hơn nói sai)", async () => {
    const valkey = makeFakeValkey(new Map());
    // `null` = hợp đồng "Valkey tắt/lỗi" của ValkeyService.
    valkey.sAddWithTtl.mockResolvedValue(null as never);
    const { svc, emitChatPresence } = makeService({ valkey });

    await expect(svc.markOnline(CO, USER, "s1")).resolves.toBeUndefined();
    expect(emitChatPresence).not.toHaveBeenCalled();
  });

  it("truy vấn peer ném ⇒ nuốt-có-log, KHÔNG lan lên handleConnection", async () => {
    const { svc } = makeService({
      valkey: makeFakeValkey(new Map()),
      peersImpl: async () => {
        throw new Error("DB down");
      },
    });

    await expect(svc.markOnline(CO, USER, "s1")).resolves.toBeUndefined();
  });

  it("Valkey CHƯA cấu hình ⇒ presence tắt hẳn, không có bản sao in-memory nói dối", async () => {
    const { svc, emitChatPresence } = makeService({
      valkey: makeFakeValkey(new Map(), /* enabled */ false),
    });

    await svc.markOnline(CO, USER, "s1");

    expect(emitChatPresence).not.toHaveBeenCalled();
    expect(await svc.getOnlineUserIds(CO, [USER])).toEqual([]);
  });
});

describe("ChatPresenceService — phạm vi người nhận", () => {
  it("chỉ peer DM nhận sự kiện; không có peer ⇒ KHÔNG emit (tránh phát cả namespace)", async () => {
    const { svc, emitChatPresence } = makeService({
      valkey: makeFakeValkey(new Map()),
      peers: [],
    });

    await svc.markOnline(CO, USER, "s1");

    // Emitter tự chặn mảng rỗng, nhưng service vẫn gọi với danh sách rỗng — đóng đinh CẢ HAI đầu.
    expect(emitChatPresence).toHaveBeenCalledWith(CO, { userId: USER, status: "online" }, []);
  });

  it("danh sách peer đọc TỪ DB trong phạm vi tenant, không từ tham số bên ngoài", async () => {
    const { svc, listDirectPeerUserIds } = makeService({
      valkey: makeFakeValkey(new Map()),
      peers: ["peer-a", "peer-b"],
    });

    await svc.markOnline(CO, USER, "s1");

    expect(listDirectPeerUserIds).toHaveBeenCalledWith(expect.anything(), CO, USER);
  });
});

describe("ChatPresenceService — getOnlineUserIds (chuẩn bị cho ảnh chụp lúc mở app)", () => {
  let store: Map<string, FakeEntry>;
  let svc: ChatPresenceService;

  beforeEach(async () => {
    store = new Map();
    svc = makeService({ valkey: makeFakeValkey(store) }).svc;
  });

  it("lọc đúng người đang có socket", async () => {
    await svc.markOnline(CO, "user-online", "s1");

    expect(await svc.getOnlineUserIds(CO, ["user-online", "user-offline"])).toEqual([
      "user-online",
    ]);
  });

  it("danh sách rỗng ⇒ rỗng, không đụng Valkey", async () => {
    expect(await svc.getOnlineUserIds(CO, [])).toEqual([]);
  });

  it("🔒 MỘT khoá lỗi KHÔNG giết cả danh sách — người còn lại vẫn đúng, và lỗi có LOG (S8-CHAT-UX-QA-1)", async () => {
    // Đo coverage 07/08: nhánh `catch` này (`chat-presence-reader.service.ts:75-81`) chưa từng chạy.
    // Nó là đường mà cả roster đi qua: nuốt im lặng ⇒ presence chết dần mà không ai biết; ném lên ⇒ cả
    // danh sách thành viên 500 vì một tính năng mỹ thuật. Cả hai đều sai, nên phải có ca ghim ở giữa.
    const store = new Map<string, FakeEntry>();
    const flaky = makeFakeValkey(store);
    const good = "44444444-4444-4444-8444-444444444444";
    const bad = "55555555-5555-4555-8555-555555555555";
    const built = makeService({ valkey: flaky });
    await built.svc.markOnline(CO, good, "s1");
    await built.svc.markOnline(CO, bad, "s2");

    const badKey = built.svc.presenceKey(CO, bad);
    (flaky.sCard as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(
      async (key: string) => {
        if (key === badKey) throw new Error("valkey timeout");
        return store.get(key)?.members.size ?? 0;
      },
    );
    const warn = vi
      .spyOn(
        (built.reader as unknown as { logger: { warn: (m: string, c?: unknown) => void } }).logger,
        "warn",
      )
      .mockImplementation(() => undefined);

    expect(await built.svc.getOnlineUserIds(CO, [good, bad]), "người kia vẫn phải online").toEqual([
      good,
    ]);
    expect(warn, "nuốt im lặng = presence chết dần không ai biết").toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0] as string).toContain(bad);
    warn.mockRestore();
  });
});
