import { describe, expect, it } from "vitest";
import { isOriginAllowed, parseCorsOrigins, resolveValkeyChannelKey } from "./ws-adapter-config";

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
