# S7-CHAT-QA-1 — ma trận truy vết nghiệm thu CHAT

> Bằng chứng cho `harness/backlog.mjs` → `S7-CHAT-QA-1`. Nguồn yêu cầu: **SPEC-15 §20** (12 tiêu chí
> nghiệm thu) · **§21** (12 nhóm scenario) · **§12** (20 mã lỗi) · **§19** (NFR).
> Đo trên `master` (HEAD `32ccd2a4` + WO này), lane DB **`mediaos_s7qa1`** chain-migrate `0000 → 0541`.
>
> Nguyên tắc của tài liệu này: **mỗi ô trỏ tới file : tên ca CÓ THẬT.** Ô nào là NỢ thì ghi NỢ —
> không có ô nào "coi như đạt".

---

## 1. Bộ test CHAT sau WO này

Số ca lấy từ **lần chạy thật** (không đếm tay):
`vitest run test/integration/chat-*.int-spec.ts test/integration/s7-chat-*.int-spec.ts src/chat`
→ **28 file · 577 ca · 577 passed / 0 failed**.

### 1.1 Integration (`test/integration/**` — cần `LANE_DB`)

| File | Ca | Vai trò |
| --- | --- | --- |
| `chat-be1-access.int-spec.ts` | 19 | membership = ranh giới quyền; `assertMember` là cửa DUY NHẤT |
| `chat-be1-rooms.int-spec.ts` | 14 | vòng đời phòng · N+1 · unread bằng phép trừ |
| `chat-be2-messages.int-spec.ts` | 29 | gửi/thu hồi/ghim/đọc · idempotent · phân trang |
| `chat-be3-attachments.int-spec.ts` | 19 | tệp đính kèm · resolver fail-closed |
| `chat-be4-search.int-spec.ts` | 22 | **ranh giới tìm kiếm** (đường đọc rộng nhất) |
| `chat-be5-derived-rooms.int-spec.ts` | 30 | đồng bộ phòng ban/dự án · job đối soát |
| `chat-be7-oversight.int-spec.ts` | 38 | **đọc-vượt membership §3.3** + audit bắt buộc |
| `chat-be8-file-upload.int-spec.ts` | 11 | presign own-scope qua cửa CHAT |
| `chat-be-gate2-visible-from-seq.int-spec.ts` | 7 | §13.4 lịch sử trước khi tham gia |
| `chat-noti-e2e.int-spec.ts` | 22 | producer/consumer NOTI · dedupe · dead-letter |
| `chat-rt0-ws-adapter.int-spec.ts` | 10 | handshake · origin allowlist |
| `chat-rt1-realtime.int-spec.ts` | 14 | emit sau commit · join/leave theo membership |
| `s7-chat-db1-invariants.int-spec.ts` | 38 | append-only · RLS · GRANT · catalog quyền |
| **`chat-qa1-acceptance.int-spec.ts`** 🆕 | 7 | CHAT-ERR-002 (2 tầng) · §20 ca 2 ở tầng HTTP |
| **`chat-qa1-scale.int-spec.ts`** 🆕 | 6 | §19/§21 nhóm "Hiệu năng" ở 50.000 tin |
| **Cộng** | **286** | (273 ca cũ + **13 ca mới**) |

### 1.2 Unit colocated (`src/chat/**` — luôn chạy, KHÔNG cần DB)

| File | Ca |
| --- | --- |
| `chat.permissions.spec.ts` | 96 |
| `chat-oversight.permissions.spec.ts` | 30 |
| **`chat-error-code-census.spec.ts`** 🆕 | 23 |
| `chat-oversight.census.spec.ts` | 20 |
| `chat-message-file.resolver.spec.ts` | 19 |
| `chat-search-cursor.spec.ts` | 15 |
| `chat-search.sql.spec.ts` | 15 |
| `chat-visibility.spec.ts` | 15 |
| `chat-file.constants.spec.ts` | 13 |
| `chat-realtime-after-commit.spec.ts` | 13 |
| `chat-oversight-audit-cursor.spec.ts` | 12 |
| `chat-oversight.mapper.spec.ts` | 11 |
| `chat-oversight-audit-filter.spec.ts` | 9 |
| **Cộng** | **291** (268 cũ + **23 mới**) |

**Tổng: 28 file · 577 ca.** Ba file 🆕 do WO này thêm (**36 ca**); 541 ca còn lại do 9 WO trước để lại
và **được WO này xác minh chạy thật**, không viết lại (chống hai-nguồn-sự-thật).

---

## 2. §21 — 12 nhóm scenario

| # | Nhóm | Ca đại diện (file : tên ca) | Trạng thái |
| --- | --- | --- | --- |
| 1 | **Deny-path (RED trước)** | `chat-be1-access` : *ca 1+2 phòng có thật mà mình không thuộc và phòng KHÔNG tồn tại trả 404 GIỐNG HỆT NHAU* · *ca 3 roomId của TENANT KHÁC → 404* · *ca 4 người đã `left_at`* · *ca 3b MỌI endpoint nhận roomId* · `chat-be4-search` : *ca 6/7* · `chat-rt1-realtime` : *🔒 thiếu cặp quyền · 🔒 bớt thành viên → socket rời NGAY* · `chat-be3-attachments` : *ca 8 người NGOÀI PHÒNG (có download:foundation-file) → 403* | ✅ |
| 2 | **Đọc-vượt membership (§3.3)** | `chat-be7-oversight` : 39 ca (16 → 29) · `console/src/lib/nav.spec.ts` : *[crown-deny-path] caps `view:*` / `*:chat-oversight` → VẪN ẩn* | ✅ |
| 3 | **Ranh giới tìm kiếm** | `chat-be4-search` : *ca 1 không dấu* · *ca 3+4 roomId không thuộc và không tồn tại → 404 GIỐNG HỆT* · *ca 19 phòng đã xoá mềm* · *ca 20 roomId tenant khác* · *ca 23 cursor người khác* | ✅ |
| 4 | **Validate — 20 mã lỗi §12** | `src/chat/chat-error-code-census.spec.ts` : *CHAT-ERR-0xx có ít nhất 1 ca* ×20 · `chat-qa1-acceptance` : *biên HTTP roomType='%s' → 400* (bít mã cuối cùng còn thiếu) | ✅ **đã bít** |
| 5 | **Idempotent** | `chat-be2-messages` : *ca 5 gửi lại cùng clientMessageId* · `chat-be1-rooms` : *ca 9/9b DM hai lần → CÙNG roomId* · `chat-be3-attachments` : *ca 6* | ✅ |
| 6 | **Thứ tự & phân trang** | `chat-be2-messages` : *ca 3+4 beforeSeq VÀ afterSeq cùng lúc → CHAT-ERR-016* · *ca 6 room_seq LIÊN TỤC* · `chat-be4-search` : *ca 13 hai trang không sót không lặp* · *ca 21 lệch 1µs* · `chat-qa1-scale` : *lật 3 trang bằng beforeSeq trên tập lớn* | ✅ |
| 7 | **Đã đọc** | `chat-be2-messages` : *ca 17+18 chỉ TIẾN (2 thiết bị) + kẹp trần* · *ca 19 tự nâng con trỏ* · *ca 23 hai giao dịch /read ĐỒNG THỜI* | ✅ |
| 8 | **Đồng bộ phòng dẫn xuất** | `chat-be5-derived-rooms` : khối A (tạo/đóng) · B (tx nguồn) · C (job đối soát) · D (bất biến) · E (vá FULL gate) | ✅ |
| 9 | **Append-only** | `s7-chat-db1-invariants` : khối A *app role KHÔNG sửa được body — 42501* · khối B *REVOKE DELETE* · khối H *least-privilege* · `chat-be2-messages` : *ca 21 DB ép bất biến* | ✅ |
| 10 | **Tệp** | `chat-be3-attachments` : *ca 2 gắn tệp NGƯỜI KHÁC → 403* · *ca 12 thu hồi → FOUNDATION download 403* · *gỡ đăng ký resolver → 403* · `chat-be8-file-upload` : 11 ca | ✅ |
| 11 | **Realtime** | `chat-rt1-realtime` : *emit sau commit* · *thêm/bớt thành viên → join/leave NGAY* · *REALTIME_ENABLED=false → REST vẫn đúng hoàn toàn* · `chat-rt0-ws-adapter` : 8 ca handshake | ✅ |
| 12 | **Hiệu năng** | `chat-be1-rooms` : *ca 11 danh sách ≥3 phòng dùng ĐÚNG 1 truy vấn* · `chat-be2-messages` : *ca 20 /unread-count* · `chat-qa1-scale` : *§19 danh sách phòng vẫn ĐÚNG 1 truy vấn khi 50k tin* · *§20 ca 5 @ 50k tin* | ⚠️ **đạt ở 50k — ngưỡng @1 triệu là NỢ, xem §5** |

---

## 3. §20 — 12 tiêu chí nghiệm thu tổng quát

| # | Tiêu chí | Ca chứng minh | RED-proof |
| --- | --- | --- | --- |
| 1 | 2 người nhắn, hiện < 1s không tải lại | `chat-rt1-realtime` : *thành viên phòng nhận `chat:message` realtime; NGƯỜI NGOÀI phòng thì không* | — |
| 2 | Tạo phòng ban → phòng chat đúng nhân sự; chuyển người → **không đọc được tin mới của phòng cũ** | `chat-be5-derived-rooms` : *ca 1* · *ca b* (tầng service) · **`chat-qa1-acceptance` : *chuyển A→B: phòng cũ trả 404 ở CẢ /messages lẫn /search*** (tầng HTTP 🆕) | — |
| 3 | Thêm người vào dự án → đọc được lịch sử trước đó (§13.4) | `chat-be5-derived-rooms` : *ca 5 (H1)* · `chat-be-gate2-visible-from-seq` : *v1 thành viên đọc TOÀN BỘ lịch sử* | — |
| 4 | Gửi ảnh + PDF; người ngoài 404/403 ở **cả** hai đường | `chat-be3-attachments` : *ca 8* · *ca 10* | — |
| 5 | Tìm "bao cao" ra "báo cáo"; **không** chứa tin phòng ngoài | `chat-be4-search` : *ca 1* · *ca 2* · `chat-qa1-scale` : *§20 ca 5 @ 50k tin* | ✅ **P1** |
| 6 | Thu hồi → mọi máy thấy ngay; tệp hết tải được | `chat-rt1-realtime` : *thu hồi: đúng 1 `chat:message-recalled`* · `chat-be3-attachments` : *ca 12* | — |
| 7 | Tắt `REALTIME_ENABLED` → vẫn đúng qua bù `afterSeq` | `chat-rt1-realtime` : *REALTIME_ENABLED=false → gateway TỪ CHỐI ở handshake, REST vẫn đúng hoàn toàn* | — |
| 8 | Cross-tenant: mọi endpoint deny | `chat-be1-access` : *ca 3 · ca 3b* · `chat-be4-search` : *ca 7 · ca 20* · `chat-be7-oversight` : *ca 23* · `s7-chat-db1-invariants` : khối C | — |
| 9 | Role **không** có `('view','chat-oversight')` bị chặn mọi đường | `chat-be7-oversight` : *ca 16 · 16b · 16c* | ✅ **P2** |
| 10 | Role có cặp → đọc được **và** đúng 1 hàng audit; ép audit lỗi → không trả dữ liệu | `chat-be7-oversight` : *ca 17* · *ca 19 (CHAT-ERR-020)* | ✅ **P3** |
| 11 | Người có cặp gọi `/chat/search` → chỉ phòng mình là thành viên | `chat-be7-oversight` : *ca 22* · `chat-be4-search` : *ca 9* | ✅ **P1** |
| 12 | Tài khoản chỉ có `*:*` → **không** thấy lối vào CHAT-SCREEN-007 | `console/src/lib/nav.spec.ts` : *[crown-deny-path] caps `%s` → VẪN ẩn* | ✅ **P4** |

Cột **RED-proof** = có bằng chứng đột biến trong
[`S7-CHAT-QA-1-RED-before-GREEN.md`](S7-CHAT-QA-1-RED-before-GREEN.md). `done_when` chỉ đòi 5 ca
(5·9·10·11·12) — đúng 5 ca đó có bằng chứng.

> **Vì sao chủ thể không phải Super Admin:** SA giữ `*:*` **và** được `SuperAdminBootstrapService`
> grant mọi cặp catalog ⇒ ca positive dùng SA xanh kể cả khi guard khai sai resource hoặc quên guard
> hoàn toàn. Mọi ca oversight ở trên dựng role riêng trong test (`grantPairs`), tên role nêu trong
> tiêu đề ca. Đối chiếu: `s7-chat-db1-invariants` : *CHAT-DEC-004: KHÔNG role canonical nào giữ
> view:chat-oversight*.

---

## 4. Phát hiện (KHÔNG sửa ở WO này — WO QA không chạm production code)

| # | Phát hiện | Bằng chứng | Đề xuất |
| --- | --- | --- | --- |
| 1 | **CHAT-ERR-002 không có ca nào** trong toàn bộ int-spec CHAT trước WO này — mã duy nhất trong 20 mã §12 bị bỏ trống | census ĐỎ lúc mới viết: *"CHAT-ERR-002 không xuất hiện ở int-spec CHAT nào"* | ✅ đã bít trong WO này (`chat-qa1-acceptance`) |
| 2 | **2 hằng mã lỗi CHẾT** — `BODY_INVALID` (ERR-004) và `EDIT_UNSUPPORTED` (ERR-007) không có caller nào trong `src/chat` | `chat-error-code-census.spec.ts` : *hằng mã lỗi chết được KIỂM SOÁT* | **Chết-LÀNH, không phải lỗi.** ERR-004 do Zod `min(1).max(4000)` gác ở biên; ERR-007 ép bằng SỰ VẮNG MẶT (0 route `@Patch`/`@Put` + column-GRANT ở DB). Giữ hằng làm tài liệu; allowlist đã ghim để hằng chết **thứ ba** làm đỏ. Cân nhắc gỡ ở `S7-CHAT-CLEAN-1` |
| 3 | **CHAT-ERR-002 ép ở HAI tầng** với hai mã HTTP khác nhau: biên Zod → **400**, service `createGroup` → **422** (không tới được qua HTTP) | `chat-qa1-acceptance` : *biên HTTP → 400* + *tầng service → 422* | Đúng thiết kế (defense-in-depth cho đường gọi nội bộ). Ca test đóng đinh **cả hai** để gỡ tầng nào cũng đỏ |
| 4 | **`paths` của WO thiếu `apps/console/src/**`** — màn CHAT-SCREEN-007/008 sống ở `apps/console`, không phải `apps/app` như `paths` khai | `console/src/router.tsx:193` · `console/src/lib/nav.ts:210` | ✅ đã nới `paths` trong `harness/backlog.mjs` (hook `guard-scope` + gate đọc đúng vùng) |

---

## 5. NỢ tường minh (KHÔNG đóng dấu "đạt")

| # | Nợ | Vì sao chưa đo được ở đây | Đo ở đâu |
| --- | --- | --- | --- |
| 1 | **§19: tìm kiếm < 800ms ở ~1 triệu tin** | Lane dev gieo 50.000 tin (`chat-qa1-scale`). Suy tuyến tính từ 50k lên 1M là đoán, không phải đo — hình dạng chi phí GIN + thống kê planner đổi theo quy mô | Môi trường có dữ liệu thật (PROD/staging sau khi CHAT bật `is_active`), hoặc WO đo tải riêng |
| 2 | **§19: độ trễ commit→hiện máy nhận < 1 giây** | `chat-rt1-realtime` chứng minh ĐÚNG NGHIỆP VỤ (emit sau commit, đúng người nhận), không đo độ trễ mạng thật | Đo tay lúc UAT / WO perf |

Số đo tham chiếu thu được ở 50.000 tin / 25 phòng (1 máy dev, Postgres trong Docker) — **ghi để so
sánh về sau, KHÔNG phải ngưỡng nghiệm thu**:

| Đường | Đo được | Ngưỡng §19 |
| --- | --- | --- |
| `GET /chat/search` (deny, 0 hit) | ~150ms | < 800ms @ 1M tin (nợ) |
| `GET /chat/search` (allow, 50 hit) | ~40ms | < 800ms @ 1M tin (nợ) |
| `GET /chat/rooms` (5 phòng, 1 truy vấn) | ~6ms | không N+1 ✅ |
| `GET /messages?limit=50` | ~13ms | < 300ms ✅ |

---

## 6. Cách chạy lại bộ test này

```bash
# 1) lane DB cô lập (chain-migrate 0000 → head)
bash scripts/lane-db-setup.sh s7qa1

# 2) chạy như CI — deny-path/cross-tenant thực sự THỰC THI
bash harness/check.sh --lane-db=s7qa1
```

> ⚠️ `pnpm test` **không** có `LANE_DB` sẽ **SKIP** đúng những ca deny-path quan trọng nhất
> (`describe.skipIf(!hasLaneDb)`) — và SKIP không phải FAIL. Kết luận "xanh" từ lệnh đó không dùng
> được cho module này (memory `src-green-is-not-integration-green` · `integration-test-lane-db-gate`).
