# S7-CALL-QA-1 — nghiệm thu `done_when` #4: gọi 1-1 hai trình duyệt

> **Trạng thái: CHƯA CHẠY.** Đây là phần DUY NHẤT của WO không tự động hoá được — cần camera/mic thật và
> mắt/tai người xác nhận "thấy hình, nghe được tiếng". Bảng §3 để trống chờ điền.
>
> Phần API của WO (nhóm A–D + C5/C6) đã xong: `S7-CALL-QA-1-COVERAGE.md`.

---

## 1. 🔴 CẤM chạy trên DB `mediaos`

`.env` trỏ `DATABASE_URL=…/mediaos`, và đó là **cụm PROD đang sống — 45 nhân viên thật**.
`pnpm dev` mặc định sẽ tạo `chat_rooms`/`chat_calls`/`chat_call_participants`/`audit_logs` THẬT trên đó
và **đổ chuông tới người thật**. `apps/api/test/db-target.ts:49` denylist đúng tên này
(`PROTECTED_DB_NAMES = ["mediaos","mediaos_dev"]`) nhưng denylist đó chỉ gác **test**, KHÔNG gác
`pnpm dev`.

⇒ Chạy api + app với `DATABASE_URL`/`DATABASE_DIRECT_URL` trỏ **`mediaos_s7callqa1`**.

Về `modules.is_active = false` của CHAT: **không cần bật**. Cờ này KHÔNG chặn request nào
(memory `module-is-active-is-not-a-gate`); bật nó chỉ thêm rủi ro cho UI mà không đổi gì ở đường API.

## 2. Dựng môi trường

```bash
# (1) DB cô lập — nếu chưa có
bash scripts/lane-db-setup.sh s7callqa1 --reset
source scripts/lib/db-secrets.sh && db_secrets_load

# (2) Trỏ api + app sang lane, KHÔNG dùng .env mặc định
export DATABASE_URL="postgresql://…@127.0.0.1:6432/mediaos_s7callqa1"
export DATABASE_DIRECT_URL="postgresql://…@127.0.0.1:5432/mediaos_s7callqa1"
export REALTIME_ENABLED=true

# (3) Chạy
pnpm --filter @mediaos/api dev
pnpm --filter @mediaos/app dev
```

Seed 2 tài khoản test thuộc company test + 1 phòng `direct` giữa hai người đó, rồi **xoá sạch sau khi
đo**. Hai người phải có đủ cặp `('call','chat-room')` — thiếu nó thì handshake `/ws-call` bị từ chối
`forbidden` và bước 1 hỏng vì lý do không liên quan tới thứ đang đo.

⚠️ Ràng buộc 1-1 nằm ở **FE** (owner chốt 10/08): nút gọi chỉ hiện khi phòng là `direct` **và** có đúng
2 thành viên chưa rời. Phòng nhóm ⇒ không có nút, không phải lỗi.

## 3. Bảng bằng chứng — mỗi dòng một ảnh

| # | Bước | Điều phải THẤY | Kết quả | Ảnh |
| --- | --- | --- | --- | --- |
| 1 | A bấm nút gọi | A: khung "đang gọi"; B: **chuông + khung đến** | ⬜ | |
| 2 | B bấm nhận | Hai bên `active`; **thấy hình + nghe được tiếng** nhau | ⬜ | |
| 3 | A tắt mic, B tắt cam | Chỉ báo đổi ĐÚNG phía, bên kia thấy ngay | ⬜ | |
| 4 | A chia sẻ màn hình | B thấy màn hình A | ⬜ | |
| 5 | A gác máy | Hai bên về `ended`, **camera TẮT hẳn** (đèn webcam tắt) | ⬜ | |
| 6 | Ngắt mạng B giữa cuộc gọi | A thấy trạng thái rõ ràng, peer connection được dọn, **không treo camera** | ⬜ | |

**Bước 6 đáng giá nhất:** nó chính là `done_when` #3 của `S7-CALL-FE-1` và tới nay **chưa có gì canh** —
1.241 dòng FE cuộc gọi hiện **0 spec** (nhóm E đã tách sang `S7-CALL-QA-2`). Tới khi QA-2 chạy, bước 6
là bằng chứng DUY NHẤT cho tính chất "mất mạng ⇒ không treo camera".

## 4. Đọc kèm — hai lỗ CÒN MỞ khi nghiệm thu

Nghiệm thu này nói về **đường API + component chạy được**, KHÔNG nói hệ đã kín:

1. **`S7-CALL-RT-FIX-1`** — token hết hạn ngay lúc bắt tay vẫn được NHẬN và nhận relay vô thời hạn.
2. **`S7-CALL-RT-FIX-2`** — gỡ thành viên giữa cuộc gọi: vẫn relay TỚI họ, đồng thời ngắt + ghi sự kiện
   an ninh cho họ.
3. **TURN thật chưa được đo** — `ice-config` có ca gate + ca thoái-lui-STUN, nhưng chưa cuộc gọi nào đi
   qua TURN Cloudflare thật. Nếu hai máy cùng LAN thì bước 2 xanh **không** chứng minh TURN chạy.
