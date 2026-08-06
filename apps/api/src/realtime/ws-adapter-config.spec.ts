import { describe, expect, it } from "vitest";
import {
  isOriginAllowed,
  parseCorsOrigins,
  resolveEnvScope,
  resolveValkeyChannelKey,
} from "./ws-adapter-config";

/** S7-CHAT-RT-0 — suy cấu hình Socket.IO từ env (thuần tuý, không server/ioredis). */
describe("parseCorsOrigins", () => {
  it("tách theo dấu phẩy và TRIM từng phần tử", () => {
    expect(parseCorsOrigins("http://a.test , http://b.test,http://c.test")).toEqual([
      "http://a.test",
      "http://b.test",
      "http://c.test",
    ]);
  });

  it("bỏ phần tử rỗng do dấu phẩy thừa (không sinh origin '' khớp bừa)", () => {
    expect(parseCorsOrigins("http://a.test,,  ,http://b.test,")).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
  });
});

describe("isOriginAllowed", () => {
  const allowlist = ["http://localhost:5273", "https://funtimemediacorp.com"];

  it("CHO PHÉP origin có trong danh sách", () => {
    expect(isOriginAllowed("http://localhost:5273", allowlist)).toBe(true);
    expect(isOriginAllowed("https://funtimemediacorp.com", allowlist)).toBe(true);
  });

  it("TỪ CHỐI origin ngoài danh sách", () => {
    expect(isOriginAllowed("http://evil.test", allowlist)).toBe(false);
  });

  it("TỪ CHỐI origin chỉ khớp một phần (chống bẫy so khớp chuỗi con)", () => {
    expect(isOriginAllowed("https://funtimemediacorp.com.evil.test", allowlist)).toBe(false);
    expect(isOriginAllowed("http://localhost:52730", allowlist)).toBe(false);
    // Khác scheme = khác origin theo RFC 6454.
    expect(isOriginAllowed("https://localhost:5273", allowlist)).toBe(false);
  });

  it("CHO PHÉP khi KHÔNG có header Origin (client không phải trình duyệt)", () => {
    expect(isOriginAllowed(undefined, allowlist)).toBe(true);
    expect(isOriginAllowed("", allowlist)).toBe(true);
  });

  it("'*' trong danh sách mở cho mọi origin", () => {
    expect(isOriginAllowed("http://evil.test", ["*"])).toBe(true);
  });

  it("danh sách RỖNG từ chối mọi origin trình duyệt (fail-closed, không mở toang)", () => {
    expect(isOriginAllowed("http://a.test", [])).toBe(false);
  });
});

/**
 * S8-CHAT-UX-RT-1 — `resolveEnvScope` là danh tính môi trường DÙNG CHUNG cho mọi không gian khoá trên
 * Valkey (kênh Socket.IO + khoá presence). Bốn môi trường thật của dự án phải phân biệt TỪNG ĐÔI MỘT —
 * đây là bằng chứng cấp-phép-suy cho `done_when` 3 (bằng chứng cấp-hành-vi ở `chat-presence.service.spec`).
 */
describe("resolveEnvScope — bốn môi trường thật phân biệt từng đôi một", () => {
  // Đo từ ĐÚNG giá trị trong .env.* của repo (06/08/2026), không phải giá trị bịa.
  const ENVS = {
    prod: { NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/mediaos" },
    // .env.dev-online KHÔNG đặt NODE_ENV ⇒ env.schema default 'development'; DB là `mediaos_dev`.
    devOnline: {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://u:p@localhost:5432/mediaos_dev",
    },
    devLocal: { NODE_ENV: "development", DATABASE_URL: "postgres://u:p@localhost:6432/mediaos" },
    test: { NODE_ENV: "test", DATABASE_URL: "postgres://u:p@localhost:5432/mediaos" },
  } as const;

  it("PROD và dev-online KHÔNG BAO GIỜ chung phạm vi (cùng một Valkey, khác không gian khoá)", () => {
    // Nếu ca này đỏ: người đang mở dev-online sẽ hiện "đang online" với người dùng PROD.
    expect(resolveEnvScope(ENVS.prod)).not.toBe(resolveEnvScope(ENVS.devOnline));
    expect(resolveEnvScope(ENVS.prod)).toBe("production:mediaos");
    expect(resolveEnvScope(ENVS.devOnline)).toBe("development:mediaos_dev");
  });

  it("cả bốn phạm vi đôi một khác nhau", () => {
    const scopes = [
      resolveEnvScope(ENVS.prod),
      resolveEnvScope(ENVS.devOnline),
      resolveEnvScope(ENVS.devLocal),
      resolveEnvScope(ENVS.test, "mediaos_s8chatuxrt1"),
    ];
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it("kênh Socket.IO và khoá presence suy từ CÙNG một phép — không có phép thứ hai để trôi", () => {
    expect(resolveValkeyChannelKey(ENVS.prod)).toBe(`socket.io:${resolveEnvScope(ENVS.prod)}`);
  });
});

describe("resolveValkeyChannelKey", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/mediaos" };

  it("gồm NODE_ENV và tên database", () => {
    expect(resolveValkeyChannelKey(prod)).toBe("socket.io:production:mediaos");
  });

  it("LANE_DB thắng DATABASE_URL (tiến trình test phục vụ DB lane)", () => {
    expect(resolveValkeyChannelKey(prod, "mediaos_chatrt0")).toBe(
      "socket.io:production:mediaos_chatrt0",
    );
  });

  it("BẤT BIẾN: kênh của test KHÔNG BAO GIỜ trùng kênh PROD dù chung một Valkey", () => {
    const test = { NODE_ENV: "test", DATABASE_URL: prod.DATABASE_URL };
    expect(resolveValkeyChannelKey(test)).not.toBe(resolveValkeyChannelKey(prod));
    // Kể cả khi NODE_ENV bị .env ép thành 'production' trong lần chạy test, LANE_DB vẫn tách kênh.
    expect(resolveValkeyChannelKey(prod, "mediaos_chatrt0")).not.toBe(
      resolveValkeyChannelKey(prod),
    );
  });

  it("KHÔNG BAO GIỜ trả về khoá mặc định 'socket.io' trần của thư viện", () => {
    expect(resolveValkeyChannelKey({ NODE_ENV: "development" })).not.toBe("socket.io");
    expect(resolveValkeyChannelKey({ NODE_ENV: "development" })).toBe("socket.io:development:nodb");
  });

  it("DATABASE_URL không parse được → 'nodb', không ném", () => {
    expect(resolveValkeyChannelKey({ NODE_ENV: "test", DATABASE_URL: "khong-phai-url" })).toBe(
      "socket.io:test:nodb",
    );
  });
});
