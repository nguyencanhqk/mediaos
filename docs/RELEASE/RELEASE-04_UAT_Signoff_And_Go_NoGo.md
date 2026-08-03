# RELEASE-04 — UAT SIGN-OFF (bản thảo) · GO/NO-GO · BÀN GIAO SPRINT 6

> Sinh trong `S5-UAT-1`. Khung: `QA-09 §33` (business sign-off) · `QA-10 §25` (sign-off matrix) ·
> `IMPLEMENTATION-08 §22.2` + `§26` (Go/No-Go sang Sprint 6).
> Chốt bản thảo: **2026-07-26** · `master` `153e2101`.
>
> ⚠️ **Đây là BẢN THẢO chờ ký.** Không ô "Quyết định" nào được điền sẵn thay người ký. Phiên tự động
> chỉ điền cột **bằng chứng** và **khuyến nghị**.

---

## 1. Điều kiện để chữ ký có hiệu lực

Chỉ ký khi đủ Exit criteria `QA-09 §12`:

| Mã | Điều kiện | Trạng thái hôm nay |
| --- | --- | --- |
| QA09-EXIT-001 | 100% scenario UAT P0 đã chạy | ❌ chưa chạy (Cycle 1 chưa mở) |
| QA09-EXIT-002 | ≥95% scenario UAT P1 đã chạy | ❌ chưa |
| QA09-EXIT-003 | 100% P0 pass | ❌ chưa |
| QA09-EXIT-004 | P1 pass ≥95% hoặc có waiver | ❌ chưa |
| QA09-EXIT-005 | Không còn bug Blocker/Critical mở | ✅ **đạt** (0 / 0) |
| QA09-EXIT-006 | Major còn mở có workaround + được Business Owner chấp nhận | ⏳ 6 mục S2 đã có workaround, **chờ chấp nhận** |
| QA09-EXIT-007 | Known issues đã cập nhật | ✅ `RELEASE-02` |
| QA09-EXIT-008 | UAT summary report đã gửi | ⏳ mẫu sẵn ở KIT §7 |
| QA09-EXIT-009 | Business Owner ký nghiệm thu | ❌ chưa |
| QA09-EXIT-010 | Go/No-Go có kết luận rõ | ⏳ §4 |

> **Cập nhật sau `S6-QA-FINAL-1` (WS3 · 2026-07-26, `master` `c845a777`).** Bằng chứng kỹ thuật cho mọi
> ô ở §2 nay tập trung ở **`docs/QA/evidence/S6-QA-FINAL-1-FINAL-QA-PASS.md`**: 15/15 flow regression
> P0, 5/5 vai, 8 nhóm API (đo được **72%** đường dẫn), toàn workspace **759 file spec · 10.102 test ·
> 0 fail**. `QA09-EXIT-005` vẫn ✅ (`S0=0 · S1=0`); `QA09-EXIT-006` nay là **6** mục S2 (thêm KI-025).
>
> **EXIT-001…004 và 009 không nhúc nhích được bằng test** — chúng cần UAT Cycle 1 với người thật.
>
> ~~Cycle 1 đang kẹt ở đúng **một** nút: stack UAT `:3200` dùng chung `apps/api/dist` với PROD `:3100`
> (KI-016)... tách `dist` (`S6-OPS-DISTSPLIT-1`, chưa mở WO) mở khoá cả hai.~~
>
> ✅ **NÚT ĐÓ ĐÃ HẾT — đo lại 2026-08-04.** `G4` cutover xong 02/08 và **KI-016 đóng**. Bằng chứng là
> HÀNH VI, không phải cấu hình: dịch vụ `MediaOS-API` chạy `apps\api\releases\current\main.js`
> (release `20260802-065551__1.0.0-rc.1__e1eebddd`), trong khi `apps\api\dist\main.js` **đã bị build
> lại lúc 03/08 20:24** bởi các lượt `pnpm build`/`typecheck` của phiên dev — và PROD **không hề hấn
> gì**. Đó đúng là kịch bản từng làm PROD login 500 trước cutover (memory
> `prod-dist-shared-with-devonline-landmine`). ⇒ Không còn `S6-OPS-DISTSPLIT-1` nào phải mở.
>
> **Việc còn lại để mở Cycle 1 thuần là VẬN HÀNH, không phải kỹ thuật:** hiện **không có gì nghe ở
> `:3200`** (đo `Get-NetTCPConnection`) — stack UAT chỉ là chưa dựng. Dựng lại theo `G5`
> (clone PROD → `mediaos_dev` → `m dev-online-fast`) rồi chạy bộ kịch bản `S5-UAT-1-UAT-KIT.md` §5 với
> người thật. Sau đó `EXIT-001…004` mới có số, và `EXIT-009` mới ký được.
>
> ⚠️ **`EXIT-006` cập nhật 2026-08-04:** không còn 6 mục S2 mà **3** — `KI-021` · `KI-025` · `KI-050`
> (`KI-056` đóng nhờ `G1`; ba mục kia rời danh sách ở các đợt trước, xem `RELEASE-02` §cuối). Cả 3 đều
> có workaround; vẫn **chờ Business Owner chấp nhận**. Thêm một rủi ro **đã ký** ngoài danh sách KI:
> mục **`D4`** ở §3 (tắt ép-2FA trên vai `QUẢN LÝ CẤP CAO`).

---

## 2. Sign-off theo module (bản thảo — QA-09 §35)

Ký từng module sau khi chạy đủ scenario tương ứng ở `S5-UAT-1-UAT-KIT.md` §5.

| Module | Scenario UAT | Bằng chứng kỹ thuật sẵn có | Chặn còn lại | Quyết định | Người ký | Ngày |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH / Home | UAT-EMP-01…04, 27, 30 | int-spec auth/session/2FA/logout đủ; 0 bug mở | — | ☐ Go ☐ Cond ☐ No-Go | | |
| ME (`/me`) | UAT-EMP-05, 24…29 | `me-personal-hub` + `me-qa1-idor-sweep` (IDOR sạch) | — | ☐ ☐ ☐ | | |
| HR | UAT-HR-01…19 | scope Own/Team/Dept/Company + mask lương/CCCD + xuất file ép loại PII | — | ☐ ☐ ☐ | | |
| ATT | UAT-EMP-07…10, 16, 17 · UAT-MGR-06…09 | chấm trùng→409, đua→1 thắng, cấm tự-duyệt | ~~KI-001~~ đã đóng | ☐ ☐ ☐ | | |
| LEAVE | UAT-EMP-11…15 · UAT-MGR-02…05, 10 · UAT-HR-13…16 | sổ số dư append-only, sync ATT, hoàn phép khi huỷ | ~~KI-001 + KI-002~~ đã đóng | ☐ ☐ ☐ | | |
| TASK | UAT-EMP-18…20 · UAT-MGR-11…15 | ma trận quyền theo dự án, fail-closed 404, việc con đếm-lá | — | ☐ ☐ ☐ | | |
| NOTI | UAT-EMP-21…23 · UAT-MGR-16 | deep-link mất-quyền→403, delivery log append-only, chống trùng | KI-005 (trễ widget) · **KI-006** (LMS) | ☐ ☐ ☐ | | |
| DASH | UAT-EMP-06 · UAT-MGR-01 · UAT-HR-01 | widget theo vai, count-only + không PII, suy giảm cục bộ | **KI-012** (D3 chờ ký) · KI-005 | ☐ ☐ ☐ | | |
| SYSTEM / Foundation | UAT-ADM-01…17 | audit append-only, cài đặt che giá trị nhạy cảm, module toggle | — | ☐ ☐ ☐ | | |
| GOAL *(ngoài MVP gốc)* | UAT-MGR-18 | phân rã 1 giao dịch, IDOR chéo tenant→404 | KI-020 (chưa có dữ liệu) | ☐ ☐ ☐ | | |
| LMS *(tích hợp)* | UAT-EMP-28 | SSO-only + audit + đồng bộ người dùng | KI-006: catalog `0529` đã áp; còn token + deploy | ☐ ☐ ☐ | | |

---

## 3. Rủi ro cần owner ký chấp nhận (không phải bug)

| Mã | Nội dung | Rủi ro tồn dư | Ký |
| --- | --- | --- | --- |
| **D3** (KI-012) | Widget `hr-overview` gate bằng **quyền widget**, không theo data-scope ⇒ HR được cấp scope Department vẫn thấy **con số** headcount toàn công ty | Lộ **tổng hợp** headcount xuyên phòng ban. **Không** lộ PII cá nhân; deep-link chi tiết vẫn bị module nguồn ép scope | ☐ Chấp nhận cho MVP ☐ Yêu cầu sửa trước release |
| **D1** (KI-013) | `refresh` và `resetPassword` không throttle | Mitigation: refresh có reuse-detection + `FOR UPDATE`; reset token entropy cao, lưu hash, dùng-một-lần, hết hạn ngắn | ☐ Giữ nguyên ☐ Mở WO thêm throttle |
| ~~Scope~~ | ~~4 nhánh ngoài 7 module MVP gốc đã ship ở Sprint 5 (ME · GOAL · LMS · BRAND)~~ | — | ✅ **ĐÃ CHỐT 2026-07-26** (`S6-GOV-1`): **ME** vào gate ở mức **P1**; **GOAL · LMS · BRAND** trong release nhưng mức **P2**, không chặn RC. Xem `RELEASE-05` §2 |
| **D4** (2026-08-04) | **TẮT `requires_two_factor` trên vai `QUẢN LÝ CẤP CAO` (369/379 quyền)** theo chỉ đạo owner. Trước đó cờ đang BẬT và đang chặn thật 3 người chưa enroll. Sau khi tắt: 4 người mang vai này đăng nhập **chỉ bằng mật khẩu**, trừ ai đã tự bật TOTP | Tài khoản gần-toàn-quyền (đọc được hồ sơ nhân sự **chưa mask** của toàn bộ nhân viên) chỉ còn **một** lớp bảo vệ. Đây đúng là rủi ro mà `KI-056` mô tả, nay **cố ý chấp nhận** ở vai khác. **Giảm nhẹ:** vai `SA` (379) và `company-admin` (329) **GIỮ NGUYÊN** ép 2FA và cả 2 tài khoản `SA` đã enroll; `ngocha.nguyen20385@gmail.com` đã tự bật TOTP nên **vẫn** bị hỏi mã lúc đăng nhập (login challenge chạy theo `user_totp.enabled_at`, độc lập với cờ vai) | ☑ **Owner chấp nhận 2026-08-04** — chỉ đạo trực tiếp trong phiên; thực thi bằng `UPDATE roles SET requires_two_factor = false WHERE id = '18172dcf-…'` |

---

## 4. Go / No-Go sang Sprint 6 (IMPLEMENTATION-08 §26)

### 4.1 Đối chiếu điều kiện

| # | Điều kiện Go (§26.1) | Đạt? | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Không còn bug P0 | ✅ | 0 |
| 2 | P1 còn lại không chặn RC hoặc có workaround rõ | ✅ | 0 P1; 6 mục S2 đều có workaround (`RELEASE-02`) |
| 3 | UAT P0 flow đã pass | ❌ | **Cycle 1 chưa chạy** |
| 4 | Permission/data-scope trọng yếu pass | ✅ | ma trận 5 scope × 7 module, mỗi ô cite spec đang chạy |
| 5 | Build staging/UAT ổn định | ⚠️ | DB UAT **đã ở head 0529** + dữ liệu UAT đã sẵn; còn **chưa bật** stack :3200 |
| 6 | Migration/seed pass | ✅ | migrate-from-empty ✅ trong CI; **PROD + UAT đều 197/197** (2026-07-26) |
| 7 | QA Lead + Product Owner + Tech Lead đồng ý | ⏳ | §5 |

### 4.2 Khuyến nghị của phiên chạy Cycle 0

> **CONDITIONAL GO sang Sprint 6.**
>
> Chất lượng kỹ thuật đã đủ điều kiện bước vào giai đoạn ổn định hoá: 10.086 test xanh (0 fail),
> 0 lỗ bảo mật CRITICAL/HIGH mở, hiệu năng baseline dư ngưỡng, ma trận phân quyền phủ kín.
> Hai điều kiện Go còn thiếu (**#3 UAT** và **#5 môi trường**) **không phải vấn đề mã nguồn** — chúng
> là 3 việc vận hành/dữ liệu đã được chỉ đích danh và có cách làm cụ thể (`Cycle-0 §4.2`).
>
> Vì Sprint 6 mở đầu bằng *scope freeze* + *stabilization* (chưa phải RC/go-live), việc mở Sprint 6
> song song với đóng 3 chặn UAT là hợp lý và không giấu rủi ro. **Nhưng KHÔNG được đi tiếp tới RC**
> (`S6-REL-1`) khi UAT chưa pass và chưa có chữ ký nghiệp vụ.

### 4.3 Điều kiện kèm theo (bắt buộc, theo dõi ở Sprint 6)

| # | Điều kiện | Owner | Hạn đề xuất | Chặn |
| --- | --- | --- | --- | --- |
| ~~C1~~ | ~~Áp migration `0529` cho `mediaos_dev` + `mediaos`~~ | — | ✅ **xong 2026-07-26** | — |
| ~~C2~~ | ~~Đóng UAT-BLOCK-001/002 (hồ sơ NV + số dư phép)~~ | — | ✅ **xong 2026-07-26** | — |
| C3 | Chạy UAT Cycle 1 đủ P0 + ghi biên bản | Owner + business user | tuần 1 Sprint 6 | sign-off |
| C4 | Ký D3 + D1 (~~+ quyết định scope 4 nhánh mở rộng — ✅ **xong 2026-07-26**, `RELEASE-05` §2~~) | Owner | tuần 1 Sprint 6 | đóng sổ MVP |
| C5 | Diễn tập khôi phục backup + lưu biên bản | Owner/DevOps | trước RC | go-live |
| C6 | Sửa/gỡ khoá job `Dependency scan` | Owner/DevOps | trước RC | CI xanh |
| C7 | Cấp thư mục build riêng cho PROD (gỡ landmine `dist` dùng chung) | Owner/DevOps | trước go-live | go-live |
| C8 | Cảnh báo tự động (5xx-rate · disk · backup-fail · SSL) | Owner/DevOps | trước go-live | go-live |

---

## 5. Sign-off matrix cấp release (QA-10 §25 — bản thảo)

| Vai trò | Người | Điều kiện ký | Quyết định | Ngày | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| Product Owner | | Scope MVP · defer list · release notes | ☐ Go ☐ Cond ☐ No-Go | | |
| Business Owner | | UAT + nghiệm thu nghiệp vụ | ☐ ☐ ☐ | | **chưa đủ điều kiện ký** (§1) |
| QA Lead | | Kết quả test · ngưỡng bug · regression | ☐ ☐ ☐ | | bằng chứng: `RELEASE-01` §4 |
| Tech Lead | | Kiến trúc · rủi ro kỹ thuật | ☐ ☐ ☐ | | |
| Backend Lead | | API · nghiệp vụ · migration | ☐ ☐ ☐ | | lưu ý C1 |
| Frontend Lead | | UI · route · state · tích hợp API | ☐ ☐ ☐ | | |
| DevOps Lead | | Deploy · backup · rollback · monitoring | ☐ ☐ ☐ | | lưu ý C5/C7/C8 |
| Security Owner | | Kết quả security · chấp nhận rủi ro | ☐ ☐ ☐ | | lưu ý D3 (§3) |
| Support/Operation | | Hypercare · kênh hỗ trợ · hướng dẫn | ☐ ☐ ☐ | | chưa lập — `S6-REL-1` |

Quyết định cuối: ☐ Go ☐ **Conditional Go** ☐ No-Go

---

## 6. Bàn giao sang Sprint 6 (IMPLEMENTATION-08 §22.2)

| # | Hạng mục bàn giao | Nơi tra |
| --- | --- | --- |
| 1 | Bug P0/P1 còn mở | **0 / 0** — `RELEASE-01` §9 |
| 2 | Bug P2/P3 được chấp nhận defer | `RELEASE-02` §1 (6 × S2 · 14 × S3) + §4 |
| 3 | UAT sign-off / conditional sign-off | tài liệu này §2 + §4 |
| 4 | Build ổn định nhất | `master` `153e2101` |
| 5 | Migration/seed đã test | journal head `0529` (197); migrate-from-empty verify trong `api.yml`; seed UAT `scripts/seed-staging-accounts.mjs` |
| 6 | Regression cần chạy lại ở Sprint 6 | toàn bộ 759 file — **chạy chia chunk** (KI-014) |
| 7 | Checklist RC còn thiếu | `RELEASE-01` §11 |
| 8 | Known limitations cần thông báo stakeholder | `S5-UAT-1-UAT-KIT.md` §9 |

### 6.1 Ánh xạ đầu vào Sprint 6

| Mã đầu vào (IMPL-09) | Yêu cầu | Đáp ứng bởi |
| --- | --- | --- |
| **IMP09-IN-003** | UAT scenario đã chuẩn bị ở Sprint 5 | `S5-UAT-1-UAT-KIT.md` §5 — 84 scenario / 4 vai, mỗi bước trỏ route thật |
| **IMP09-IN-004** | Known issue đang mở đã được phân loại | `RELEASE-02` — 20 mục, có mức/loại/workaround/chủ |
| IMP09-IN-001 | Scope MVP đã chốt | ✅ **đóng 2026-07-26** — `RELEASE-05` §2 (freeze 3 tầng T1/T2/T3) |
| IMP09-IN-002 | Flow P0/P1 đã xác định | `S5-UAT-1-UAT-KIT.md` §2 + §5 |
| IMP09-IN-006 | Staging hoạt động ổn định | ⚠️ DB + dữ liệu đã sẵn (C1/C2 xong); còn bật stack :3200 |

### 6.2 Việc gợi ý mở WO ở Sprint 6

| Gợi ý WO | Nội dung | Nguồn |
| --- | --- | --- |
| `S6-OPS-MIGDEBT-1` | ~~Đưa PROD + UAT lên head `0529`~~ (xong 2026-07-26) — còn: **kiểm tra định kỳ "migration tồn đọng"** để không tái diễn | KI-006 |
| `S6-QA-CHUNK-1` | Sửa gốc crash `ERR_IPC_CHANNEL_CLOSED` hoặc chuẩn hoá chạy chia chunk vào `check.sh`/CI | KI-014 |
| `S6-OPS-BACKUP-DRILL-1` | Chạy + ghi biên bản diễn tập khôi phục | KI-008 |
| `S6-OPS-DISTSPLIT-1` | Tách thư mục build PROD khỏi repo dev | KI-016 |
| `S6-OBS-ALERT-1` | Cảnh báo tự động + log JSON có cấu trúc | KI-009 · KI-011 |
| `S6-DASH-REFRESH-ROLE-1` | Sửa đường refresh MV dashboard (KHÔNG dùng `ALTER OWNER`) | KI-017 |
| `S6-DATA-HYGIENE-1` | Dọn loại nghỉ trùng + trạng thái đơn lẫn hoa/thường + nhập ngày lễ | KI-003 · KI-004 · KI-018 |
| `S6-QA-NOTIAUDIT-1` | Dọn nhiễu log outbox bridge trong test | KI-015 |
