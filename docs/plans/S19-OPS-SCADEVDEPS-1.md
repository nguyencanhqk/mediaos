# S19-OPS-SCADEVDEPS-1 — vá advisory mức cao/critical ở devDependency của hai app vệ tinh (SOCIAL · LMS)

> Zone 🟡 · 06/11/2026 · nguồn: `docs/plans/S19-OPS-SCASATELLITE-1.md` §9 N1 + D-2 + O8.
> Repo PUBLIC ⇒ tên gói / mã advisory / số đo theo gói **không** ghi ở đây (sổ ngoài repo: lịch sử phiên + commit repo LMS local).

## 1. Đo trước (06/11/2026)

| App | Cây | Trước | Sau |
| --- | --- | --- | --- |
| SOCIAL (`apps/fbpost`, npm) | toàn cây (gồm dev) | 2 critical · 1 high · 3 moderate | 0 critical · 0 high · 2 moderate |
| SOCIAL | `--omit=dev` (cổng CI hiện tại) | 0 high/critical · 2 moderate | không đổi |
| LMS (repo git riêng, pnpm) | — | số đo ở commit repo LMS local (chưa ghi ở đây tới khi LMS PROD chạy bản vá) | 0 high/critical |

## 2. Thi công

- **SOCIAL:** nâng major bộ chạy test lên dòng 4.x ổn định (KHÔNG lên 5.x — major mới) ⇒ chuỗi dev kéo theo
  hết advisory. Đổi `package.json` + `package-lock.json`, không đổi mã nguồn / cấu hình test.
  Kiểm trên worktree: typecheck xanh · test 19 tệp, 184 ca qua, 4 ca bỏ qua (ca ổ chia sẻ thật, `skipIf` env —
  có từ trước) · `next build` xanh. Yêu cầu Node mới (`^20.19 || >=22.12`): CI Node 22, PROD v24.15 — đạt.
- **LMS:** nâng một dependency (minor, cùng major) + 3 override hẹp cho chuỗi dev của bộ lint, cùng kiểu
  override của S19-OPS-SCASATELLITE-1 (selector chỉ bắt dải dính advisory, đích cùng major, bản đích > 72 giờ —
  `minimumReleaseAge` giữ nguyên). Commit `7631a92` trên nhánh `fix/scadevdeps-1` của repo LMS local
  (worktree `C:\dev 2\lms-scadev`). Kiểm: lint 0 lỗi (6 cảnh báo như master) · `test:email` xanh ·
  `next build` xanh 4/6 lượt (1 lượt đỏ prerender ở lần build ĐẦU của worktree, không tái hiện ở 4 lượt sau kể
  cả khi xoá DB; 1 lượt crash native access violation) — master 2/2 xanh. Rủi ro hành vi của bản nâng: ghi ở
  commit repo LMS.

## 3. Deploy

- SOCIAL: chỉ đổi devDependency ⇒ **mã chạy PROD không đổi**. Lần cài deps kế tiếp của dịch vụ Social (dừng
  `MediaOS-Social` TRƯỚC rồi mới `npm ci` — bẫy EPERM) sẽ cài cây dev mới. Không cần deploy riêng.
- LMS: deploy = owner (dịch vụ chạy thẳng từ `apps/lms`; build ở đó là đụng PROD): backup `data/app.db*` →
  merge `fix/scadevdeps-1` vào `master` của repo LMS → `pnpm install --frozen-lockfile` → `pnpm build` →
  `m prod-restart lms` ngay sau build → đo origin `localhost:3400`.

## 4. Quyết định còn chờ owner (done_when 3)

Mở rộng cổng SCA sang quét cả dev (bước CI fbpost `npm audit` bỏ `--omit=dev`, và/hoặc `m sca`)? Hiện cổng
chỉ quét dependency chạy thật theo quyết định 19/10. Nếu mở rộng: phải đo cổng ĐỎ thật trên một bản dính lỗi
rồi xanh lại, ghi quyết định vào đây.

## 5. Còn lại (moderate, ngoài phạm vi high/critical)

- SOCIAL: 2 moderate ở dependency chạy thật (thư viện bảng tính → chuỗi con) — sửa cần major của thư viện đó.
- LMS: moderate ở thư viện gửi mail (bản vá trong cùng major) + 2 gói dev.
