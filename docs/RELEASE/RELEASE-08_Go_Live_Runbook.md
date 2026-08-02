# RELEASE-08 — GO-LIVE RUNBOOK · DEPLOYMENT · ROLLBACK (WS8)

> Work Order **`S6-REL-1`** · `RELEASE-GO-001` · nguồn: [IMPLEMENTATION-09](../IMPLEMENTATION/IMPLEMENTATION-09_Sprint_6_Stabilization_Release_Candidate_Go-live_Execution_Plan.md) §17
> Chốt: **2026-07-30** · `master` `c4afe351` · migration head **`0534_s6secmv1_dashboard_mv_tenant_barrier`** (202)
> Cơ chế kỹ thuật (nguồn sự thật): [DEVOPS-01](../DEVOPS/DEVOPS-01_DevOps_Architecture_Environment_Strategy.md) · [DEVOPS-10 Backup/Rollback/DR](../DEVOPS/DEVOPS-10_Backup_Rollback_Disaster_Recovery.md) — tài liệu này KHÔNG định nghĩa lại, chỉ ghi **thứ tự · ai bấm · verify bằng gì**.
>
> **Quy tắc của runbook này: mọi bước là LỆNH CHẠY ĐƯỢC.** `IMPL-09` §17 viết ở mức khái niệm ("Deploy
> backend", "Smoke test"); ở đây mỗi ô là lệnh gõ được trên máy PROD, kèm cách biết bước đó đã xong.
> Bước nào chưa có lệnh thì ghi **CHƯA CÓ**, không viết cho đủ mặt.

---

## 1. Hạ tầng thật đang chạy (đo 2026-07-30)

| Thành phần | Thực tế | Kiểm bằng |
| --- | --- | --- |
| API PROD | Windows service NSSM **`MediaOS-API`** → `node apps\api\dist\main.js`, cwd = gốc repo, đọc `.env` | `m prod-status` |
| LMS PROD | NSSM **`MediaOS-LMS`** → `apps\lms` (Next.js, PORT 3400, workspace RIÊNG) | `m prod-status` |
| FE PROD | Cloudflare Pages — apex `funtimemediacorp.com` (`web-mediaos`) · `auth.` · `console.` | `m prod-status` |
| Vào từ ngoài | `cloudflared` tunnel → `api.` `train.` | `m prod-status` |
| DB | Postgres trong docker `mediaos-postgres` · DB **`mediaos`** · PgBouncer `:6432` · Valkey · MinIO | `m prod-status` |
| Artifact release | `apps\api\releases\<stamp>` + junction `releases\current` (**S6-REL-1**) | `node scripts/release-artifact.mjs list` |

⚠️ **Trạng thái cutover:** service PROD **vẫn trỏ `apps\api\dist`** (đo 2026-07-30). Xem §3 — phải chạy
`m prod-cutover` MỘT LẦN thì KI-016 mới đóng ở máy này.

---

## 2. Nhánh · version · tag

Theo `RELEASE-05` §6: trunk-based trên **`master`**, RC = **tag annotated trên master**, KHÔNG tạo
nhánh `release/*`. Version nguồn = `package.json` gốc (**`1.0.0-rc.1`**), đóng dấu vào artifact bởi
`scripts/stamp-build.mjs` và đọc lại được ở `GET /api/v1/health` → `data.build`.

```bash
# SAU khi PR đã merge vào master (RELEASE-05 §6.2.1 — không tag nhánh làm việc)
git checkout master && git pull

# ⚠️ TAG SAU CÙNG, KHÔNG TAG TRƯỚC: phải deploy xong rồi mới tag, và tag đúng commit ĐANG CHẠY.
#    Xác minh trước khi tag — bước này đã cứu được một lần tag lệch (xem bên dưới):
node scripts/release-smoke.mjs --expect-commit "$(git rev-parse --short HEAD)"

git tag -a v1.0.0-rc.<n> -m "MediaOS MVP RC<n>
migration head: <head hiện tại — đọc bằng 'm prod-status', KHÔNG chép lại số ở đây>
release notes: docs/RELEASE/RELEASE-07_Release_Candidate_v1.0.0-rc.1.md
CR nhận từ RC trước: <liệt kê PR đã vào từ RC trước>"
git push origin v1.0.0-rc.<n>
```

Tag **không bao giờ move**. Sai thì cắt `-rc.<n+1>` (`RELEASE-05` §6.2 quy tắc 4).

> **Đã dẫm phải 2026-08-02 — đọc trước khi tag.** `v1.0.0-rc.1` bị cắt tại `6f160b9a` **trước** lần
> build lại cuối, trong khi PROD sau đó chạy `a968fcfe`. Phần chênh đúng bằng PR #324, nên `rc.1` trỏ
> vào một bản có lỗi FE đã được vá ⇒ **`v1.0.0-rc.1` không dùng để rollback được**; mốc đúng là
> **`v1.0.0-rc.2` @ `a968fcfe`**. Bài học: **deploy → `--expect-commit` → mới tag**, đừng tag rồi deploy.
>
> Lưu ý `data.build.version` đọc từ `package.json` nên **không đổi** giữa các rc (`1.0.0-rc.1` ở cả
> rc.1 lẫn rc.2). Định danh có thẩm quyền là **`data.build.commit`**.

---

## 3. Cutover MỘT LẦN — tách PROD khỏi `dist` dùng chung (KI-016)

**Vì sao:** service đang chạy thẳng `apps\api\dist` — chính thư mục mà `m dev-online` biên dịch lại.
Bật UAT có thể đẩy binary mới vào PROD trong khi DB chưa có migration tương ứng (đã gây PROD login 500
ngày 2026-07-08). Ngoài ra `dist` bị ghi đè mỗi lần build ⇒ **không có bản trước để quay về**.

```powershell
m prod-update api     # build → snapshot vào releases\<stamp> → migrate → restart
m prod-cutover        # (Administrator) trỏ NSSM sang apps\api\releases\current\main.js
m prod-status         # phải thấy "service tro vao releases\current"
```

Quay lại đường cũ nếu cần: `nssm set MediaOS-API AppParameters "apps\api\dist\main.js"`.

> Đã kiểm chứng cơ chế (2026-07-30, KHÔNG đụng service PROD): boot artifact từ `releases/current` trên
> DB lane cô lập, `@nestjs/core` · `@mediaos/contracts` · `drizzle-orm` phân giải đúng, `/health` trả
> định danh build, smoke **10/10 PASS**. Xem `RELEASE-07` §5.

---

## 4. Dòng thời gian go-live (IMPL-09 §17.2)

### T-3 / T-2

| # | Việc | Lệnh | Xong khi |
| --- | --- | --- | --- |
| 1 | Chốt RC | §2 | Tag `v1.0.0-rc.1` có trên `master` |
| 2 | Duyệt release checklist | `RELEASE-07` §2 | Không ô nào CHƯA ĐẠT còn chặn |
| 3 | **Backup rehearsal** | `BACKUP_DIR=./backups bash scripts/backup-db.sh` | Có file `backups/mediaos-*.dump*` |
| 4 | **Restore drill** | `bash scripts/backup-restore-drill.sh` | `drill PASS` (dump → restore DB tạm → verify → tự dọn) |
| 5 | Deployment rehearsal trên staging | `m dev-online-db` → `m dev-online-fast` | `:3200` trả `/health` 200 |
| 6 | Regression P0 + smoke trên staging | `node scripts/release-smoke.mjs --base http://localhost:3200/api/v1 --strict` | 10/10 PASS |
| 7 | UAT final sign-off | `RELEASE-04` | Business owner ký |

### T-1

| # | Việc | Lệnh | Xong khi |
| --- | --- | --- | --- |
| 8 | Freeze code/config | — | Không merge PR nào ngoài hotfix (`RELEASE-05` §4) |
| 9 | Chốt release notes | `RELEASE-07` | Mục "Known issues" khớp `RELEASE-02` |
| 10 | Kiểm env/secret/domain/SSL | `node scripts/ops-alert-check.mjs` | Không có `crit`; `unknown` phải có lý do |
| 11 | Thông báo lịch go-live | §7 | Đã gửi |

### T-0 (thứ tự BẮT BUỘC — IMPL-09 §17.3)

| Bước | Hành động | Lệnh | Verify |
| ---: | --- | --- | --- |
| 1 | Xác nhận cửa sổ release | — | Owner đồng ý |
| 2 | **Dừng dev-online** (landmine dist) | `m dev-online-stop` | `:3200` đóng |
| 3 | **Backup DB** | `BACKUP_DIR=./backups bash scripts/backup-db.sh` | Ghi lại tên file dump vào biên bản |
| 4 | Deploy FE | `m prod-update fe` | Pages deploy xong |
| 5 | Build + snapshot + **migrate** + restart API | `m prod-update api` | Fail-closed: schema chưa ở head ⇒ **KHÔNG restart** |
| 6 | Seed nếu cần | `m seed` (chặn DB được bảo vệ) hoặc idempotent seed-on-boot | Log `MasterDataSeedRunner … 0 lỗi` |
| 7 | Deploy LMS | `m prod-update lms` | `:3400` 200 |
| 8 | Canary | `CANARY_BASE_URL=http://localhost:3100/api/v1 bash scripts/canary-watch.sh --once` | exit 0 |
| 9 | **Smoke** | `node scripts/release-smoke.mjs --expect-commit <sha>` | 10/10 PASS · `RC-BUILD-MATCH` PASS |
| 10 | Mở truy cập người dùng | — | Người thật đăng nhập được |
| 11 | Giám sát | `node scripts/ops-alert-check.mjs` (lặp theo lịch, `RELEASE-09` §4) | Không `crit` |
| 12 | Công bố | §7 | Đã gửi |

> **Bước 9 bắt buộc có `--expect-commit`.** Không có nó, smoke xanh chỉ chứng minh "một hệ thống nào đó
> đang chạy tốt" — đúng cái bẫy restart-≠-rebuild đã xảy ra trên dự án này.

### T+1 → T+3 — hypercare

Xem `RELEASE-09` §6.

---

## 5. Rollback

### 5.1 Khi nào bấm (IMPL-09 §17.5)

| Trigger | Xử lý |
| --- | --- |
| Đa số user không đăng nhập được | Rollback app NGAY |
| API auth/session lỗi diện rộng | Rollback app NGAY |
| **Lộ dữ liệu ngoài phạm vi quyền** | Tắt tính năng / rollback NGAY (BẤT BIẾN #1) |
| Migration làm sai/mất dữ liệu | DỪNG release, restore cần approval (§5.4) |
| Check-in/out ghi sai dữ liệu | Tắt hành động ATT hoặc rollback |
| Leave approval sync sai ATT diện rộng | Tắt approve hoặc hotfix |
| FE trắng trang toàn hệ thống | Rollback FE |
| DB CPU/connection tăng bất thường do release | Rollback app hoặc tắt tính năng |
| Notification spam diện rộng | Tắt job/event |
| Dashboard query gây nghẽn | Tắt widget / hotfix cache |

### 5.2 Rollback ỨNG DỤNG (đường chính, không đụng DB)

```powershell
m prod-rollback              # về bản NGAY TRƯỚC
m prod-rollback <stamp>      # về đúng một bản (xem: node scripts/release-artifact.mjs list)
```

Lệnh tự: đổi junction `current` → `verify` (syntax + phân giải dep) → restart service → chờ health.
Verify sau đó: `curl http://localhost:3100/api/v1/health` phải trả `data.build.commit` của **bản cũ**,
rồi `node scripts/release-smoke.mjs`.

⚠️ **Rollback ứng dụng KHÔNG hoàn tác migration.** Chiến lược là expand/contract (`DEVOPS-10`): bản cũ
phải chạy được trên schema MỚI. Nếu sự cố do DỮ LIỆU thì đây không phải cách chữa — xem §5.4.

### 5.3 Rollback theo lớp (IMPL-09 §17.7)

| Lớp | Hành động | Verify |
| --- | --- | --- |
| Frontend | `m prod-update fe` từ commit trước (Pages giữ lịch sử deploy, có thể rollback trên dashboard Cloudflare) | App load · login · route chính |
| Backend | `m prod-rollback` | `/health` `data.build.commit` = bản cũ · smoke |
| Config | khôi phục `.env` (`m prod-env`) + restart | Hành vi trở lại |
| DB schema | KHÔNG down-migration — dựa expand/contract | API cũ vẫn chạy trên schema mới |
| DB data | Restore từ backup (§5.4) | **Cần approval** |
| Jobs | Tắt worker/job | Hết spam/lỗi |
| Dashboard widget | Tắt widget / cache | Hết tải |
| Notification event | Tắt event/template | Hết gửi sai |

### 5.4 Restore dữ liệu (chỉ khi hỏng dữ liệu nghiêm trọng — CẦN OWNER DUYỆT)

```bash
bash scripts/backup-restore-drill.sh   # LUÔN diễn tập vào DB TẠM trước khi động vào DB thật
```

Script chỉ restore vào DB tạm tên `mediaos_drill_*` (guard prefix + blocklist `mediaos`/`mediaos_dev`).
**Restore đè DB PROD không có lệnh sẵn — cố ý.** Đó là thao tác thủ công, có người thứ hai chứng kiến,
sau khi đã dump bản hiện tại.

### 5.5 Quy trình điều phối incident (IMPL-09 §17.6)

1. Tuyên bố incident → 2. Đóng băng mọi deploy → 3. Khoanh lớp hỏng (FE/BE/DB/config/bên thứ ba) →
4. Chọn đường rollback → 5. Báo war-room → 6/7/8. Rollback artifact / tắt tính năng / khôi phục config →
9. Restore DB **chỉ khi** hỏng dữ liệu + có approval → 10. Smoke lại → 11. Giám sát → 12. Thông báo →
13. Mở post-incident review.

---

## 6. War-room

| Vai | Người | Trách nhiệm |
| --- | --- | --- |
| Release owner / quyết định Go-No-go-Rollback | **Owner** | Bấm nút cuối, là người DUY NHẤT tuyên bố rollback |
| Deploy | Owner (máy PROD, cần Administrator) | Chạy §4 T-0 |
| Verify | Owner + agent | Canary · smoke · ops-alert-check |
| Business | Business owner | Xác nhận nghiệp vụ chạy đúng |

> Dự án **1 người + agent** ⇒ war-room không phải phòng họp mà là **một cửa sổ thời gian** owner ngồi
> tại máy PROD với runbook này mở sẵn. Ghi rõ để không ai lập kỳ vọng có đội trực.

**Nhật ký sự cố bắt buộc ghi:** thời điểm · triệu chứng · `request_id` (có trong mọi response) ·
`data.build.commit` đang chạy · bước đã làm · kết quả.

---

## 7. Kế hoạch truyền thông

| Thời điểm | Ai nhận | Nội dung | Kênh |
| --- | --- | --- | --- |
| T-1 | Toàn công ty | Lịch go-live, khoảng thời gian có thể gián đoạn, kênh báo lỗi | Thông báo nội bộ |
| T-0 bắt đầu | Toàn công ty | "Bắt đầu triển khai, hệ thống có thể gián đoạn ~N phút" | Thông báo nội bộ |
| T-0 xong | Toàn công ty | "Đã xong, đăng nhập tại <URL>, báo lỗi qua <kênh>" | Thông báo nội bộ |
| Khi rollback | Toàn công ty | "Tạm hoãn, hệ thống về bản cũ, dữ liệu an toàn" | Thông báo nội bộ |
| T+3 | Owner | Tổng kết hypercare | `RELEASE-09` §6 |

---

## 8. Cái runbook này KHÔNG làm

- Không quyết Go/No-go (→ `S6-GOLIVE-1` · `RELEASE-04`).
- Không thay `DEVOPS-01`/`DEVOPS-10` về cơ chế deploy/backup/restore.
- Không có lệnh restore đè DB PROD (§5.4 — cố ý).
- Không có down-migration (chiến lược là expand/contract).
