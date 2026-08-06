# DEVOPS-14 — Triển khai app vệ tinh SOCIAL (`apps/fbpost`)

> **Phạm vi:** cách chạy, cấu hình, build lại và sao lưu ứng dụng Đăng bài Facebook Page.
> **Quyết định nền:** [DECISIONS-08](../DECISIONS/DECISIONS-08_Social_Satellite_App.md) · kế hoạch wave: [S9-SOCIAL-WAVE](../plans/S9-SOCIAL-WAVE.md)
> **Trạng thái:** 🟡 **checklist đã soạn, CHƯA cài dịch vụ.** Việc cài NSSM + mở cổng là hành động trên máy PROD, chờ owner thực hiện hoặc cho phép.

---

## 1. Bản đồ cổng

| Dịch vụ | Cổng | Cách chạy |
| --- | --- | --- |
| MediaOS API (PROD) | 3100 | NSSM |
| MediaOS API (dev-online) | 3200 | NSSM |
| LMS (`apps/lms`) | 3400 | NSSM `MediaOS-LMS` |
| **fbpost (`apps/fbpost`)** | **3500** | NSSM `MediaOS-Social` — **chưa cài** |

3500 chọn vì trống và cách xa dải đang dùng. Đổi thì phải đổi đồng thời `SOCIAL_BASE_URL` phía API.

## 2. Biến môi trường

### 2.1 Phía MediaOS API (`apps/api/.env.production`)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `SOCIAL_SSO_SECRET` | có | Shared secret HMAC ≥32 ký tự. **Phải khớp** `MEDIAOS_SSO_SECRET` phía fbpost. Tách biệt khỏi `LMS_SSO_SECRET` — lộ một cái không kéo theo cái kia. |
| `SOCIAL_BASE_URL` | có | Gốc public của fbpost, vd `https://social.funtimemediacorp.com`. |
| `SOCIAL_COMPANY_ID` | có | UUID công ty DUY NHẤT được dùng. Thiếu ⇒ endpoint trả **503**, KHÔNG phải "cho mọi công ty". |

Thiếu cả ba thì API vẫn boot bình thường; chỉ endpoint `GET /api/v1/integrations/social/sso-link` trả 503.

### 2.2 Phía fbpost (`apps/fbpost/.env.production`)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `MEDIAOS_SSO_SECRET` | có | Khớp `SOCIAL_SSO_SECRET` phía API. Lệch ⇒ mọi lần vào đều bị đá về `/login`. |
| `SOCIAL_SESSION_SECRET` | có | Ký cookie phiên, ≥32 ký tự. **Không có giá trị mặc định** — thiếu thì không ai đăng nhập được (cố ý: một giá trị dự phòng sẽ âm thầm biến hệ thành mở toang). |
| `SOCIAL_KEK_PATH` | không | Mặc định `.secrets/fbpost-kek.bin`. |
| `SOCIAL_DATA_DIR` | không | Mặc định `<cwd>/data`. Đặt tường minh khi chạy dưới NSSM — thư mục làm việc của dịch vụ không nhất thiết là thư mục mã nguồn. |
| `NEXT_PUBLIC_MEDIAOS_URL` | không | Hiện nút "Mở MediaOS" trên trang `/login`. |

## 3. Cài lần đầu

```bash
cd "apps/fbpost"
npm ci
node scripts/gen-kek.mjs          # tạo .secrets/fbpost-kek.bin — CHỈ MỘT LẦN
npm run build
npm start                          # PORT=3500 npm start
```

`gen-kek.mjs` **từ chối ghi đè** file đã có. Ghi đè KEK = mọi token Facebook đã mã hoá thành rác vĩnh viễn, phải kết nối lại từng tài khoản.

Lần khởi động đầu trên CSDL cũ sẽ tự mã hoá tại chỗ mọi token đang nằm thô (`sealPlaintextSecrets` trong `src/lib/db.ts`). Chạy được nhiều lần, không mã hoá chồng.

## 4. Build lại + khởi động lại

> ⚠️ **Hàng rào R4 của DECISIONS-08.** `next build` của fbpost ghi vào `apps/fbpost/.next` — **không** dùng chung với `dist` của API PROD. Đây chính là chỗ đã cắn thật hai lần: build LMS từng ghi đè `dist` PROD làm login 500 (xem `docs/plans/S5-LMS-*`). Trước khi build lần đầu trên máy PROD, **đo mtime** của thư mục build API rồi đo lại sau — phải không đổi.

```bash
cd "apps/fbpost"
npm run build
nssm restart MediaOS-Social
```

**Verify bằng NỘI DUNG, không bằng PID.** PID mới + log mới **không** chứng minh code mới đang chạy — dịch vụ có thể khởi động lại từ bản build cũ. Kiểm bằng một chuỗi chỉ có trong bản mới:

```bash
grep -r "<chuỗi mới>" apps/fbpost/.next/server | head -3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3500/login   # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3500/api/pages  # 401 — cổng phiên đang gác
```

Dòng thứ ba là phép thử quan trọng: **401 nghĩa là cổng phiên sống.** Nếu nó trả 200 thì middleware không chạy — dừng lại, đừng mở ra ngoài.

## 5. Worker hẹn giờ

fbpost chạy worker **in-process**, `setInterval` 60s, khởi động từ route handler đầu tiên được nạp (`src/lib/worker-boot.ts`). Có chốt `globalThis` + chặn `NEXT_PHASE=phase-production-build`.

**Phải verify sau khi cài NSSM:** đếm log tick trong 3 phút — đúng 3 lần, không phải 6. Hai worker cùng chạy sẽ đăng đôi mỗi bài.

Hệ quả phải chấp nhận (đã ghi ở DECISIONS-08 §6): dịch vụ chết thì bài đến giờ **không đăng và không có hàng đợi nào giữ lại**. Đây là chỗ vỡ đầu tiên nếu số bài lớn lên.

## 6. Sao lưu

| Thứ | Ở đâu | Ghi chú |
| --- | --- | --- |
| CSDL | `apps/fbpost/data/fbpost.db` (+ `-wal`, `-shm`) | **Không** nằm trong backup Postgres của hệ. Cần đường sao lưu riêng. |
| Media đã upload | `apps/fbpost/data/uploads/` | Cùng chỗ, cùng vấn đề. |
| **KEK** | `apps/fbpost/.secrets/fbpost-kek.bin` | **Sao lưu TÁCH KHỎI `data/`.** Để chung một chỗ thì mã hoá vô nghĩa (khoá đi kèm ổ khoá); mất riêng KEK thì mất toàn bộ token đã mã hoá. |

Dừng dịch vụ trước khi copy `fbpost.db`, hoặc dùng `sqlite3 .backup` — SQLite ở chế độ WAL không an toàn khi copy nóng bằng `cp`.

## 7. Việc CHƯA làm (bàn giao)

- [ ] Cài dịch vụ NSSM `MediaOS-Social`, cổng 3500 — **cần owner**.
- [ ] Tạo tunnel/domain public + trỏ `SOCIAL_BASE_URL`.
- [ ] Sinh và nạp 2 secret (`SOCIAL_SSO_SECRET` ↔ `MEDIAOS_SSO_SECRET`, `SOCIAL_SESSION_SECRET`).
- [ ] Đặt `SOCIAL_COMPANY_ID` = id công ty funtime.
- [ ] Áp migration `0544`/`0545` lên DB PROD — **cùng nhóm nợ với `0542`/`0543` đang chờ** (xem RELEASE).
- [ ] Cấu hình đường sao lưu riêng cho `data/` + `.secrets/`.
- [ ] Cảnh báo token Facebook sắp hết hạn (`accounts.token_expires_at` có sẵn, chưa ai đọc) — ngoài phạm vi wave S9.
