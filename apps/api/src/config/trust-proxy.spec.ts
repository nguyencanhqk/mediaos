import { Controller, Get, type INestApplication, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { parseTrustProxy } from "./trust-proxy";

/**
 * S10-AUTH-IPTRUST-1 — `parseTrustProxy` quyết định `req.ip`, tức quyết định NỘI DUNG
 * `login_logs.ip_address`, khoá bucket rate-limit per-IP, và vế so sánh của IP-allowlist (CS-9).
 *
 * Vì sao spec này gọi HTTP THẬT chứ không chỉ so giá trị trả về:
 * `parseTrustProxy` chỉ trả một chuỗi/số/bool — bản thân nó KHÔNG chống được giả mạo. Thứ chống
 * giả mạo là hành vi của `proxy-addr` bên trong Express khi nhận giá trị đó. Test chỉ assert
 * `parseTrustProxy("loopback") === "loopback"` là test đồng-nghĩa (tautology): nó vẫn XANH nguyên
 * vẹn nếu ai đó đổi sang `true` rồi sửa luôn kỳ vọng — đúng lớp lỗi "test đóng đinh lỗ hổng".
 * Nên mỗi ca dưới đây dựng một Nest app tối giản, set `trust proxy` bằng ĐÚNG một dòng của
 * `main.ts`, rồi bắn request có header bịa vào và đọc `req.ip` ra.
 *
 * Peer socket trong spec là loopback — TRÙNG với topology PROD (cloudflared chạy CÙNG MÁY nên nối
 * tới origin qua loopback; số đo `socketRemoteAddress: "127.0.0.1"` trong
 * `docs/DEVOPS/evidence/S10-AUTH-IPTRUST-1-headers-*.txt`). Nghĩa là "client" trong spec này đứng
 * đúng vị trí kẻ tấn công tệ nhất mà cấu hình `loopback` phải chịu được.
 */

const SPOOF = "203.0.113.9"; // IP kẻ tấn công TỰ khai qua header
const REAL = "198.51.100.21"; // IP mà proxy thật ghi vào

@Controller()
class IpEchoController {
  @Get("ip")
  ip(@Req() req: { ip?: string; ips: string[] }): { ip: string | undefined; ips: string[] } {
    return { ip: req.ip, ips: req.ips };
  }
}

let app: INestApplication | undefined;

/** Dựng app tối giản với ĐÚNG dòng wiring của `main.ts`. */
async function bootWith(rawTrustProxy: string): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ controllers: [IpEchoController] }).compile();
  const created = mod.createNestApplication();
  // ── giống hệt main.ts ──
  created.getHttpAdapter().getInstance().set("trust proxy", parseTrustProxy(rawTrustProxy));
  await created.init();
  app = created;
  return created;
}

async function ipSeenBy(
  rawTrustProxy: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const a = await bootWith(rawTrustProxy);
  const res = await request(a.getHttpServer()).get("/ip").set(headers).expect(200);
  return String(res.body.ip);
}

/** proxy-addr trả IPv4-mapped (`::ffff:127.0.0.1`) tuỳ stack — so sánh trên phần IPv4. */
function isLoopback(ip: string): boolean {
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("parseTrustProxy — diễn giải env", () => {
  it('"" và "false" → false (tắt: req.ip = peer socket)', () => {
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("  FALSE  ")).toBe(false);
  });

  it('"true" → true (⚠️ tin MỌI XFF — cấu hình GIẢ MẠO ĐƯỢC, xem ca HTTP bên dưới)', () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy(" True ")).toBe(true);
  });

  it("chuỗi toàn số → số hop (number, KHÔNG phải string)", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy(" 2 ")).toBe(2);
  });

  it('preset/CIDR giữ nguyên chuỗi cho proxy-addr diễn giải ("loopback" = giá trị PROD)', () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
  });
});

describe("req.ip THẬT qua Express (đây mới là thứ chống giả mạo)", () => {
  it("TRUST_PROXY=false + client TỰ gửi X-Forwarded-For ⇒ req.ip = peer socket, KHÔNG leo lên IP bịa", async () => {
    const ip = await ipSeenBy("false", { "x-forwarded-for": SPOOF });
    expect(ip).not.toBe(SPOOF);
    expect(isLoopback(ip)).toBe(true);
  });

  it("TRUST_PROXY=false + CF-Connecting-IP bịa ⇒ vẫn KHÔNG leo (Express không đọc header này)", async () => {
    const ip = await ipSeenBy("false", { "cf-connecting-ip": SPOOF });
    expect(isLoopback(ip)).toBe(true);
  });

  it("⚠️ TRUST_PROXY=true + client TỰ gửi X-Forwarded-For ⇒ req.ip = ĐÚNG IP kẻ tấn công tự chọn — ĐÓNG ĐINH VÌ SAO CẤM 'true'", async () => {
    // Ca này KHÔNG phải hành vi mong muốn: nó đóng đinh mức thiệt hại của cấu hình sai, để lần sau
    // ai định "cho gọn, đặt true đi" thì thấy ngay đây là IP-allowlist bypass + né rate-limit.
    const ip = await ipSeenBy("true", { "x-forwarded-for": SPOOF });
    expect(ip).toBe(SPOOF);
  });

  it("TRUST_PROXY=loopback + XFF MỘT phần tử (đúng số đo cloudflared 18/08) ⇒ req.ip = IP client thật", async () => {
    const ip = await ipSeenBy("loopback", { "x-forwarded-for": REAL });
    expect(ip).toBe(REAL);
  });

  it("TRUST_PROXY=loopback + XFF kiểu proxy NỐI THÊM ('<bịa>, <thật>') ⇒ req.ip = IP THẬT, không phải IP bịa", async () => {
    // Đây là ca chặn của WO: client nhét sẵn XFF rồi proxy nối IP thật vào cuối. Vì chỉ hop
    // loopback được tin, proxy-addr dừng ở phần tử phải-nhất KHÔNG tin cậy = IP thật.
    const ip = await ipSeenBy("loopback", { "x-forwarded-for": `${SPOOF}, ${REAL}` });
    expect(ip).toBe(REAL);
    expect(ip).not.toBe(SPOOF);
  });

  it("TRUST_PROXY=loopback + CF-Connecting-IP bịa nhưng XFF hợp lệ ⇒ req.ip đọc XFF, KHÔNG đọc CF-Connecting-IP", async () => {
    // Chốt chủ đích "một nguồn IP duy nhất": không có đường nào để header thứ hai lái req.ip.
    const ip = await ipSeenBy("loopback", {
      "x-forwarded-for": REAL,
      "cf-connecting-ip": SPOOF,
    });
    expect(ip).toBe(REAL);
  });

  it("RÀNG BUỘC TOPOLOGY — nếu proxy CHÈN TRƯỚC ('<thật>, <bịa>') thì loopback SẼ lấy IP bịa: đây là lý do WO cấm suy thứ tự XFF từ tài liệu", async () => {
    // KHÔNG phải hành vi mong muốn, và ĐÃ ĐO là KHÔNG xảy ra trên topology hiện tại: probe vòng 2
    // (`11-trust-proxy-spoof-probe.ps1`, evidence `…-xff-order-*.txt`) cho thấy client tự gửi
    // `X-Forwarded-For: 203.0.113.9` thì origin nhận `"203.0.113.9,<ip thật>"` — nối vào CUỐI.
    // Ca này tồn tại để: (a) ghi rõ điều kiện an toàn của `loopback` là "proxy nối IP thật vào CUỐI"
    // chứ không phải tính chất tự thân của preset, (b) nếu mai này đổi proxy mà thứ tự đảo, người đọc
    // có sẵn ca chứng minh hệ quả thay vì phải phát hiện lại từ đầu bằng một sự cố.
    const ip = await ipSeenBy("loopback", { "x-forwarded-for": `${REAL}, ${SPOOF}` });
    expect(ip).toBe(SPOOF);
  });
});
