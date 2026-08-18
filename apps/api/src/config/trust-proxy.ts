/**
 * CS-9 / S10-AUTH-IPTRUST-1 — diễn giải env `TRUST_PROXY` sang giá trị Express `trust proxy`.
 *
 * Tách khỏi `main.ts` để test được HAI CHIỀU. Trước WO này hàm nằm module-private trong
 * `main.ts` nên không ca test nào chạm tới được — mà đây là hàm quyết định `req.ip`, tức
 * quyết định nhật ký đăng nhập, bucket rate-limit per-IP, và IP-allowlist.
 *
 * ── SỐ ĐO THẬT (2026-08-18, KHÔNG suy từ tài liệu Cloudflare) ───────────────────────────
 * Đo bằng `scripts/windows/10-trust-proxy-probe.ps1`: request từ Internet → cloudflared →
 * echo server localhost. Bằng chứng thô: `docs/DEVOPS/evidence/S10-AUTH-IPTRUST-1-headers-*.txt`.
 *
 *   x-forwarded-for:     "<ip client>"        ← ĐÚNG MỘT phần tử, không phải chuỗi nhiều hop
 *   cf-connecting-ip:    "<ip client>"        ← CÓ mặt
 *   cdn-loop:            "cloudflare; loops=1"
 *   socketRemoteAddress: "127.0.0.1"          ← cloudflared nối tới origin qua LOOPBACK
 *
 * ── SỐ ĐO VÒNG 2 (2026-08-18) — CLIENT TỰ GỬI HEADER, tức ca kẻ tấn công ──────────────
 * Vòng 1 ở trên chỉ đo request "sạch". Nó KHÔNG trả lời câu quyết định: khi client tự nhét
 * `X-Forwarded-For` sẵn thì cloudflared NỐI vào cuối, CHÈN trước, hay XOÁ? Toàn bộ tính an
 * toàn của `loopback` treo trên câu đó — nối-vào-cuối thì an toàn, chèn-trước thì GIẢ MẠO
 * ĐƯỢC. Đo bằng `scripts/windows/11-trust-proxy-spoof-probe.ps1` (rẻ hơn probe 10-*: KHÔNG
 * sửa `config.yml`, KHÔNG restart cloudflared — mượn hostname dev đã trỏ sẵn vào cổng đang
 * trống). Bằng chứng thô: `docs/DEVOPS/evidence/S10-AUTH-IPTRUST-1-xff-order-*.txt`.
 *
 *   client gửi  X-Forwarded-For: 203.0.113.9
 *   origin nhận X-Forwarded-For: "203.0.113.9,<ip thật>"   ← NỐI VÀO CUỐI. IP bịa nằm BÊN TRÁI.
 *   origin nhận cf-connecting-ip: "<ip thật>"              ← Cloudflare GHI ĐÈ, không giữ giá trị client
 *   client gửi kèm CF-Connecting-IP  → HTTP 403 NGAY Ở EDGE, request KHÔNG tới origin
 *
 * ── VÌ SAO `loopback` CHỨ KHÔNG PHẢI `true` HAY `1` ────────────────────────────────────
 * Theo SỐ ĐO VÒNG 2: client tự gửi `X-Forwarded-For: 1.2.3.4` thì origin nhận
 * `"1.2.3.4, <ip thật>"` — IP thật luôn ở PHẢI NHẤT. Express/proxy-addr
 * dựng danh sách `[socket peer, ...XFF đảo ngược]` rồi bỏ qua các hop TIN CẬY tính từ phải:
 *
 *   TRUST_PROXY=false     → req.ip = "::1"       MÙ      (hiện trạng trước WO)
 *   TRUST_PROXY=true      → req.ip = "1.2.3.4"   GIẢ MẠO ĐƯỢC — kẻ tấn công tự chọn IP ⇒
 *                                                vượt IP-allowlist + né rate-limit bằng cách
 *                                                xoay IP bịa. TỆ HƠN mù. TUYỆT ĐỐI KHÔNG DÙNG.
 *   TRUST_PROXY=1         → req.ip = "<ip thật>" an toàn, nhưng con số đếm hop sẽ SAI LẶNG LẼ
 *                                                nếu sau này chèn thêm một proxy nữa.
 *   TRUST_PROXY=loopback  → req.ip = "<ip thật>" ✅ CHỌN CÁI NÀY: buộc vào topology THẬT
 *                                                (cloudflared cùng máy ⇒ luôn nối qua loopback)
 *                                                và preset phủ CẢ `127.0.0.1` LẪN `::1`.
 *
 * Không đọc thẳng `cf-connecting-ip`: Express `req.ip` là thứ mà toàn bộ hạ tầng hiện có
 * (login_logs · login-rate-limiter · IP-allowlist) đã đọc. Thêm một nguồn IP thứ hai = hai
 * cơ chế song song, cái nào đúng thì không ai biết. (Số đo vòng 2 cho thấy header đó cũng
 * không giả mạo được — nhưng "không giả mạo được" chưa phải lý do để đẻ thêm nguồn thứ hai.)
 *
 * ── ĐIỀU KIỆN AN TOÀN, ghi rõ để lần sau đổi topology thì biết phải đo lại ────────────
 * `loopback` an toàn NHỜ hai tính chất ĐÃ ĐO, không phải nhờ bản thân preset:
 *   (a) proxy nối IP thật vào CUỐI `X-Forwarded-For` (nếu có ngày nó chèn TRƯỚC, `req.ip`
 *       sẽ thành IP do kẻ tấn công tự chọn — `trust-proxy.spec.ts` có ca đóng đinh hệ quả này);
 *   (b) proxy nối tới origin qua LOOPBACK (cùng máy). Tách cloudflared sang máy khác ⇒ peer
 *       không còn loopback ⇒ `loopback` hết tin ai ⇒ `req.ip` tụt về IP của máy proxy (mù trở
 *       lại, không phải giả mạo). Khi đó phải đổi sang CIDR của máy proxy và ĐO LẠI.
 */

/**
 * "false"/"" → false (tắt, `req.ip` = socket peer — giữ nguyên hành vi dev/no-proxy, chống spoof).
 * "true" → true (⚠️ tin MỌI XFF — xem docblock trên, đây là cấu hình GIẢ MẠO ĐƯỢC).
 * Chuỗi toàn số → số hop tin cậy.
 * Còn lại → giữ nguyên chuỗi (preset "loopback" / CIDR proxy) để proxy-addr tự diễn giải.
 */
export function parseTrustProxy(raw: string): boolean | number | string {
  const v = raw.trim();
  if (v === "" || v.toLowerCase() === "false") return false;
  if (v.toLowerCase() === "true") return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
