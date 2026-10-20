# S19-SEC-FILELINKGATE-1 — gắn tệp vào thực thể theo cùng quyết định xem từng tệp (FOUNDATION link)

> Plan v1 · 20/10/2026 · mã đo trên `90ee1568` · worktree `MediaOS-flg` nhánh `fix/s19-sec-filelinkgate-1` · 🔴 FULL gate + santa.
> Số đo chi tiết (census, ví dụ cụ thể) ở kênh owner ngoài repo — repo PUBLIC, plan này chỉ ghi bất biến đích.
> Viết tắt: `F/` = `apps/api/src/foundation/files/` · `T/` = `apps/api/test/`. [ĐO] = đã đọc mã ở `90ee1568` · [SUY RA] = L1 đo.

## 1. Phạm vi + nguồn

- WO: `harness/backlog.mjs` mục `S19-SEC-FILELINKGATE-1` (done_when: đo trước · bất biến cùng vị từ `GET /foundation/files/:id` ·
  RED deny-path từng đường gắn + ALLOW đứng cạnh).
- Tiền lệ: `docs/plans/S19-SEC-FILEMETAGATE-1.md` (#594) — đầu vào quyết định dùng chung ở `F/file-view-decision.ts`.
- **Bất biến đích:** tạo một liên kết `file_links` cho tệp X chỉ khi quyết định XEM của chính người gắn cho X là ALLOW — cùng hàm,
  cùng đầu vào với `GET /foundation/files/:id`, danh sách `GET /foundation/files` và đường tải FOUNDATION.

### 1.1 Đường tạo liên kết tệp [ĐO]

| #   | Đường                                                                                                         | Vị trí                                                                                                                                                                                                             | WO này                            |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| 1   | `POST /foundation/files/:id/links`                                                                            | `F/files.controller.ts:128-143` → `F/files.service.ts:569-688`                                                                                                                                                     | lõi: cổng xem + D4                |
| 2   | `POST /tasks/:taskId/files`                                                                                   | `tasks/task-file.service.ts:161-191` → lõi `:171`                                                                                                                                                                  | thừa hưởng lõi                    |
| 3   | `POST /hr/employees/:id/files`                                                                                | `employees/employee-file.service.ts:107-130` → lõi `:117`                                                                                                                                                          | thừa hưởng lõi                    |
| 4   | `POST /hr/contracts/:id/file`                                                                                 | `employees/contract.service.ts:302-344` → lõi `:314`                                                                                                                                                               | thừa hưởng lõi                    |
| 5   | `POST /candidates/:id/files/:fileId/link`                                                                     | `recruit/recruit-candidate-file.service.ts:165-180` → lõi `:174`                                                                                                                                                   | thừa hưởng lõi (giữ xanh)         |
| 6   | `POST /me/avatar`                                                                                             | `me/me-avatar.service.ts:158-192` → lõi `:192`                                                                                                                                                                     | thừa hưởng lõi + D-6              |
| 7   | `PUT /foundation/company/branding/:kind`                                                                      | `foundation/company/company-branding.service.ts:137-152` → lõi `:144`                                                                                                                                              | thừa hưởng lõi + D-6              |
| 8   | Ghi `file_links` không qua lõi (CHAT gửi tin · avatar phòng · avatar HR · đính kèm SOCIAL · tệp xuất máy chủ) | `chat/chat-attachments.repository.ts:142` · `chat/chat-room-avatar.service.ts:390` · `employees/hr-employee-avatar.service.ts:305` · `social/social-attachments.service.ts:447` · `F/server-file.repository.ts:73` | ngoài — mỗi đường đòi chủ tệp; §9 |
| 9   | `DELETE /foundation/files/:id/links/:linkId` (gỡ)                                                             | `F/files.service.ts:694-760`                                                                                                                                                                                       | không đổi (không kênh đọc)        |
| 10  | Con trỏ `fileId` không tạo liên kết (hợp đồng create/update · hai loại đơn ATT)                               | `employees/contract.service.ts:177,236` · `attendance/attendance-adjustment.service.ts:212` · `attendance/remote-work-request.service.ts:108`                                                                      | ngoài — §9                        |

Đường đọc metadata của module (danh sách tệp TASK · tệp hồ sơ HR · CV RECRUIT · giám sát CHAT) giữ cổng thực thể có chủ đích (O-3);
đường TẢI của module đi qua `FileService.getDownloadUrl` — quyết định từng tệp, không đổi.

## 2. Quyết định owner (20/10)

- **O-1 Một vị từ XEM** cho `GET /:id` + tải FOUNDATION + hàng danh sách + lõi gắn: tệp có ≥ 1 liên kết sống ⇒ AND mọi liên kết (như
  `decideForLinkedFile`); 0 liên kết sống và chưa từng gắn ⇒ chủ tệp (`ownerUserId` = người gọi) HOẶC fallback `view:foundation-file`;
  0 liên kết sống và đã từng gắn ⇒ từ chối mọi người, kể cả chủ.
- **O-2** Chỉ vá lõi `FileService.link()`; các đường ghi `file_links` không qua lõi (§1.1 #8) đều đòi chủ tệp ⇒ chấp nhận có chủ đích, nợ §9.
- **O-3** Đường đọc metadata của module giữ cổng thực thể: tệp nằm trong thực thể E là để người đọc E thấy; biên phải chặn là phía gắn.
- **O-4** Cặp `(moduleCode, entityType)` chưa đăng ký resolver ⇒ 400 ở biên gắn.
- **O-5** `isPrimary`/`linkType`/`accessScope` do client chọn ở route FOUNDATION ⇒ không đổi, nợ. **O-6** Không dọn dữ liệu.
- **O-7** Con trỏ `fileId` không tạo liên kết ⇒ ngoài phạm vi, nợ. **O-8** Gỡ liên kết giữ nguyên.
- **O-9** Người gắn không xem được tệp ⇒ 403 `FOUNDATION-FILE-ERR-FORBIDDEN` + dòng `file_access_logs` từ chối như `canLink`; quyết định
  NGOÀI tx ghi (resolver tự mở `withTenant` — `apps/api/src/db/db.service.ts:74-91`), ngay sau `canLink`.

## 3. Thiết kế

**D-1 — Một hàm quyết định: MỚI `F/file-access-decision.ts`.**
`decideFileAccess(policy, actor, file: { id; ownerUserId }, ctx: { live; everLinked }, action: View | Download)`:
`live` rỗng ∧ `!everLinked` ∧ `ownerUserId !== null` ∧ `ownerUserId === actor.id` (∧ tenant đủ) ⇒ `{ allow: true, reason: "allow-owner" }`;
còn lại ⇒ `policy.decideForLinkedFile(fileSelfPolicyInput(...), live.map(toFileLinkRef), action, everLinked)` (hai hàm thuần import từ
`F/file-view-decision.ts`). Hàm thuần, không truy cập DB; `Delete` không thuộc kiểu `action` (biên dịch chặn). `F/file-policy.types.ts` thêm
`"allow-owner"` vào `FilePolicyReason`. Lý do không đặt vế chủ trong `FilePolicyService.decideForLinkedFile`: hàm này có người gọi ngoài
`F/` (CHAT `chat-attachments.service.ts:231`, SOCIAL `social-attachments.service.ts:564`) luôn trên tệp có liên kết; policy giữ «không DB»;
`ownerUserId` lấy từ hàng service đã nạp.

**D-2 — Bốn chỗ gọi cùng hàm.** `getMetadata` (View) · `getDownloadUrl` (Download) · `FileListService.decideRows` (View — ngữ cảnh theo lô
sẵn có `listAllByFileIdsTx` + `groupLinksByFile`, không N+1) · `link()` (View). `deleteFile` giữ `decideForLinkedFile(Delete)`.
`loadLinkContext` (private, `F/files.service.ts:957-965`) → `loadFileAccessContext(user, fileId)` = `{ row, live, everLinked }` trong MỘT
`withTenant` (một ảnh chụp; bỏ lần mở tx đọc hàng riêng ở `getMetadata`/`getDownloadUrl`/`deleteFile`).

**D-3 — Thứ tự `link()`.** (1) `assertRegisteredLinkTarget(policy, input)`: dạng chính tắc lệch ⇒ 400 LINK (giữ) · `canonicalOwnerKey` = `null`
⇒ 400 LINK (O-4; nguồn danh sách cặp = registry resolver, không chép tay) → (2) `canLink` ⇒ 403 (giữ) → (3) `loadFileAccessContext` →
(4) `assertLinkableFile(row)`: vắng ⇒ 400 LINK · Infected ⇒ 400 INFECTED · tệp tạm ⇒ 400 LINK (trước cổng xem — giữ mã lỗi hiện có) → (5)
`decideFileAccess(View)` DENY ⇒ `logDeny({ action: "Link", permissionCode: "FOUNDATION.FILE.VIEW", reason, moduleCode, entityType, entityId })`
và 403 FORBIDDEN → (6) `withTenant` ghi: đọc lại hàng + `assertLinkableFile` lần nữa → insert + audit `FileLinked` + access-log như cũ.

**D-4 — Vị trí mã (không phình `F/files.service.ts`, 1.033 dòng).** MỚI `F/file-access-decision.ts` (D-1) · MỚI `F/file-link-guard.ts`
(`assertRegisteredLinkTarget` · `assertLinkableFile` — hàm thuần ném `BadRequestException`) · `toLinkDto` chuyển sang `F/file-metadata.mapper.ts`
· `F/file-list.service.ts` gọi `decideFileAccess` · docblock `canonicalOwnerKey` (`F/file-policy.service.ts:126-148`) ghi «`null` ⇒ biên gắn từ
chối». Đo ở gate: `wc -l F/files.service.ts` < 1.033.

**D-5 — Lỗi + log.** Cổng xem ở biên gắn: 403 `FOUNDATION-FILE-ERR-FORBIDDEN`, message mang `reason` (như `GET /:id`,
`F/files.service.ts:448-458`). Cặp chưa đăng ký: 400 `FOUNDATION-FILE-ERR-LINK`. Không ghi tên tệp vào log. `deny-error` ⇒ policy đã log.

**D-6 — Đặt lại đúng tệp đang dùng = không thao tác (giữ luồng thử lại).** Branding `setAsset` và ME `setAvatar` gỡ mọi liên kết cũ rồi mới
gọi lõi gắn (`company-branding.service.ts:142-144,340-349` · `me-avatar.service.ts:189-192,228-244`) ⇒ yêu cầu lặp cùng `fileId` sẽ chạm
vế «đã từng gắn ⇒ từ chối» sau khi liên kết cũ đã gỡ ở tx khác. Sửa: liên kết sống của thực thể đã trỏ `fileId` ⇒ chỉ gỡ liên kết KHÁC, bỏ
lời gọi gắn, vẫn ghi con trỏ + trả kết quả. ⇒ **L0** mở `paths` (§7).

**D-7 — Không đổi:** contracts · FE · migration · gỡ liên kết · §1.1 #8/#10 · đường đọc module. Deploy chỉ API.

## 4. Ca test int-spec viết TRƯỚC

MỚI `T/integration/s19-sec-filelinkgate-1.int-spec.ts` qua `bootQa1World` (⇒ `applyMainPipeline`, tenant tươi); tệp + liên kết seed SQL
(không PUT storage); task/dự án/nhân viên qua `T/helpers/task-file-seed.ts` (`seedEmployee` · `seedTask` · `seedProjectMember`); hợp đồng seed
SQL. Actor tenant A — trừ khi ghi, KHÔNG giữ `view:foundation-file`: `tasker` (`file-upload`+`read:task`, thành viên dự án của task T,
`view:feed`) · `hrUp` (`file-upload`+`file-view:employee`) · `ctr` (`manage:contract`) · `linker` (`link:foundation-file` + `manage:contract`) ·
`viewLinker` (`linker` + `view:foundation-file`) · `viewer` (`view:foundation-file` + grant đối tượng DENY trên hai tệp G). Tệp: `F_other`
(chủ khác, 0 liên kết) · `F_hid` (1 liên kết tới bài người gắn không xem được) · `F_hidOwn` (chủ = người gắn, 1 liên kết như `F_hid`) · `F_rev*`
(chủ = người gắn, liên kết đã gỡ mềm) · `F_own*` (chủ = người gắn, 0 liên kết) · `F_pub` (1 liên kết tới bài xem được).

| Ca        | Actor · đường                                                | Tệp                            | Kỳ vọng                                             |
| --------- | ------------------------------------------------------------ | ------------------------------ | --------------------------------------------------- |
| K-1…K-3   | tasker · `POST /tasks/T/files`                               | `F_other` · `F_hid` · `F_revT` | 403 · 0 liên kết mới (liên kết sẵn có giữ nguyên)   |
| K-2o      | tasker · TASK                                                | `F_hidOwn`                     | 403 — vế chủ không vượt AND khi tệp đã có liên kết  |
| K-4 · K-5 | tasker · TASK                                                | `F_ownT` · `F_pub`             | 201 · +1 liên kết (ALLOW đứng cạnh)                 |
| H-1…H-3   | hrUp · `POST /hr/employees/E/files`                          | `F_other` · `F_hid` · `F_revH` | 403 · 0 liên kết mới                                |
| H-4       | hrUp · HR                                                    | `F_ownH`                       | 201                                                 |
| C-1…C-3   | ctr · `POST /hr/contracts/:id/file`                          | `F_other` · `F_hid` · `F_revC` | 403 · 0 liên kết · `file_id` của hợp đồng không đổi |
| C-4       | ctr · hợp đồng khác                                          | `F_ownC`                       | 201 · `file_id` = `F_ownC`                          |
| F-1…F-3   | linker · `POST /foundation/files/:id/links` `{HR, contract}` | `F_other` · `F_hid` · `F_revF` | 403 · 0 liên kết                                    |
| F-4 · F-5 | linker · `F_ownF`; viewLinker · `F_other` (fallback xem)     |                                | 201                                                 |
| F-6       | linker · FOUNDATION, cặp chưa đăng ký                        | `F_ownF2`                      | 400 `FOUNDATION-FILE-ERR-LINK` · 0 liên kết         |
| F-7       | viewLinker · R-3 trên mọi tệp của spec                       | tất cả                         | gắn 2xx ⇔ `GET /:id` cùng actor = 200 (allowed > 0) |
| G-1/G-1d  | viewer · `GET /foundation/files/:id`                         | `G_own` (chủ) · `G_other`      | 200 · 403 (vế chủ chỉ cho chủ)                      |
| G-2       | chủ `F_revF` (giữ `view:foundation-file`) · `GET /:id`       | `F_revF`                       | 403 (đã từng gắn ⇒ từ chối cả chủ)                  |
| V-1/V-1b  | chủ · `POST /me/avatar`, rồi lặp cùng `fileId`               | ảnh của mình                   | 2xx cả hai · đúng 1 liên kết sống                   |
| V-3/V-3b  | chủ · `PUT /foundation/company/branding/favicon`, lặp        | ảnh của mình                   | 2xx cả hai · 1 liên kết sống · tài sản còn          |

Luồng hợp lệ khác giữ xanh qua spec có sẵn (§6): RECRUIT CV · CHAT · SOCIAL · avatar HR · FILEMETAGATE.

## 5. Unit + spec có sẵn đổi kỳ vọng

- MỚI `F/file-access-decision.spec.ts` — bảng trạng thái với `FilePolicyService` thật + checker/resolver giả: 0 liên kết · chưa từng · chủ ⇒
  `allow-owner`, checker KHÔNG gọi · không chủ ⇒ fallback allow/deny · `ownerUserId` null ⇒ fallback · đã từng gắn (chủ/không chủ) ⇒
  `deny-links-revoked` · có liên kết + chủ + resolver từ chối ⇒ `deny-resolver` · liên kết thiếu resolver + chủ ⇒ `deny-no-resolver` · Download
  cùng bảng · tenant rỗng + chủ ⇒ `deny-tenant`.
- `F/files.service.spec.ts` (link): cặp chưa đăng ký ⇒ 400, `canLink` không gọi · `canLink` DENY ⇒ quyết định xem không gọi · tệp vắng ⇒ 400,
  không quyết định xem · tệp tạm + xem DENY ⇒ 400 LINK · xem DENY ⇒ 403 + log `Link`/`FOUNDATION.FILE.VIEW` + `insertTx` không gọi · chủ 0 liên
  kết ⇒ `decideForLinkedFile` không gọi, có insert · quyết định resolve TRƯỚC `withTenant` ghi · action View. Harness: `canonicalOwnerKey` mặc
  định = identity (`:176` hiện trả `null` ⇒ đổi cùng D4).
- `F/file-list.service.spec.ts` U-8b: list · `getMetadata` · `getDownloadUrl` · `link` cùng gọi `decideFileAccess`; U-8/U-8a cũ giữ nguyên.
- Spec branding/ME (`company-branding.service.spec.ts` · `me-avatar.service.spec.ts`): cùng `fileId` ⇒ không gỡ liên kết đó, không gọi lõi gắn.
- Fixture int-spec cần ghi chủ tệp (vế chủ áp đúng ý nghĩa ca): `T/integration/employee-docs-param-uuid.int-spec.ts:117-125` (seed thiếu
  `owner_user_id` ⇒ ca ALLOW-201 `:266-269`, `:346-348`) · [SUY RA] `F/file-access-hardening.int.spec.ts:312-346` (người gắn trong
  `beforeAll` ≠ chủ tệp). Mọi đổi kỳ vọng khác ghi §9.3 kèm lý do.

Mutant ★ phải đỏ: bỏ cổng xem ở lõi (K/H/C/F-1…3) · bỏ vế chủ (K-4/H-4/C-4/F-4/V-1, unit) · vế chủ cả khi đã từng gắn (K-3/H-3/C-3/F-3, unit) ·
vế chủ cả khi có liên kết (K-2o, unit) · cổng xem trước kiểm tệp tạm (unit) · bỏ O-4 (F-6) · quyết định trong tx ghi (unit thứ tự) · Download
thay View ở gắn (unit) · danh sách không qua hàm chung (U-8b) · thiếu D-6 (V-1b/V-3b) · `ownerUserId` null coi là chủ (unit).

## 6. Phép đo còn phải làm

- L1 [SUY RA]: grant đối tượng DENY dựng được bằng `T/helpers/seed.ts` `seedObjectGrant` (G-1) · fixture bài ẩn theo khuôn FILEMETAGATE ·
  `chat-be3-attachments` ca 9/12d/12e: chủ tệp từng ca (403 giữ, lý do có thể đổi — ghi sổ) · `task-files-access` `:426-460` actor = chủ tệp ·
  `s14-recruit-filegrant1-cv` cần storage hay không · mọi lời gọi `getDownloadUrl` từ module chỉ chạm tệp đã gắn vào thực thể của nó.
- RED chạy trên mã CŨ trước (`lane-vitest.sh`, lane `mediaos_flg`, ≤ 3 int-spec/lượt); chép nguyên dòng «Test Files …» vào §9.3.
- Lô chạy lại: (1) spec mới · (2) `s19-sec-filemetagate-1` + `chat-be3-attachments` + `files-http-validate` · (3) `task-files-access` +
  `employee-file` + `employee-docs-param-uuid` · (4) `me-preferences-avatar` + `me-qa1-idor-sweep` + `company-branding-deny` · (5)
  `routehttp3-foundation-settings` + `routehttp3-hr-employee` + `s19-hr-avatarwrite-1` · (6) `s14-recruit-filegrant1-cv` +
  `social-attgate-1-update-attach` + `chat-s17-be2-links` · (7) `F/file-access-hardening.int.spec.ts` (+ `s15-payroll-be5b-pdf-batch` khi có storage —
  không sửa). Unit: `foundation/files` · `foundation/company` · `me`.
- Verify: `bash harness/check.sh --all --lane-db=flg` · typecheck api · gitleaks nhánh · `wc -l F/files.service.ts`.

## 7. Lát thi công

- **L0** — commit `chore(docs)` riêng chỉ `harness/backlog.mjs`: thêm vào `paths` `apps/api/src/foundation/company/company-branding.service.ts` ·
  `…/company-branding.service.spec.ts` · `apps/api/src/me/me-avatar.service.ts` · `apps/api/src/me/me-avatar.service.spec.ts` (D-6).
- **L1 RED** — int-spec §4 + unit §5 trên mã cũ; ghi đỏ/xanh vào §9.3.
- **L2 GREEN** — D-1 → D-4 (`file-access-decision.ts` · `file-link-guard.ts` · mapper · `files.service.ts` · `file-list.service.ts` · types) →
  D-6 → sửa fixture/harness §5.
- **L3 gate** — FULL: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` + `santa-method` một vòng có trần (hội tụ trên «một
  vị từ = `GET /:id`» · «0 liên kết mới khi từ chối» · «vế chủ chỉ cho tệp chưa từng gắn» · «quyết định ngoài tx») + `typescript-reviewer` +
  `quality-gate` (coverage ≥ 80% tệp mới).
- **L4 PR** — `check.sh --all --lane-db=flg` xanh + gitleaks sạch ⇒ push sát giờ, mở PR (push = công bố).

## 8. [OWNER]

| #   | Việc                                                                                                         | Chốt                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| W-1 | Ưu tiên + ngân sách                                                                                          | Đã chọn 20/10: tới PR hôm nay        |
| W-2 | O-1 … O-9                                                                                                    | Đã chốt 20/10 (§2)                   |
| W-3 | L0 mở `paths` cho D-6 (hai service ngoài `F/`)                                                               | Theo WO notes «mở rộng `paths` ở L0» |
| W-4 | Merge `--admin` ⇒ deploy API trong ngày (`m prod-update api`); không FE/contracts nên không có cửa sổ thứ tự | Khung giờ owner                      |
| W-5 | Smoke PROD: `/health` build.commit · logo/favicon còn · gắn tệp TASK của chính mình 201 · đặt avatar ME      | Sau deploy                           |

## 9. Ngoài phạm vi · nợ · rủi ro

- Nợ (luồng chính gieo sau deploy, tiêu đề trung tính): (N1, O-2) đường ghi `file_links` không qua lõi theo cùng `decideFileAccess`, gồm vế «đã
  từng gắn» · (N2, O-5) route FOUNDATION: `isPrimary`/`linkType`/`accessScope` theo quy ước của module sở hữu · (N3,
  O-7) con trỏ `fileId` của hợp đồng và đơn ATT theo cùng vị từ · (N4) ảnh bìa TASK ký URL theo vị từ riêng (`F/cover-presign.service.ts`) ⇒ hợp
  nhất về `decideFileAccess` · (N5) `F/files.service.ts` vẫn > 800 dòng (FILEDEBT).
- Rủi ro: (a) TOCTOU giữa quyết định (ngoài tx) và ghi — chấp nhận theo O-9; người gắn đã xem được tệp tại thời điểm quyết định · (b) vế chủ
  thắng grant đối tượng DENY trên tệp chưa từng gắn — theo O-1 · (c) đường lùi: `m prod-rollback` API (không đổi schema/contracts).

### 9.3 Sổ vết

| Mốc     | Lúc              | Ghi                                                                                                                                                                                                                         |
| ------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1 | 20/10/2026 08:43 | Trên `90ee1568`. O-1…O-9 owner chốt 20/10. D-1 `decideFileAccess` (vế chủ cho tệp chưa từng gắn) dùng chung bốn chỗ · D-3 thứ tự gắn · O-4 registry resolver là danh sách cặp · D-6 đặt lại đúng tệp = không thao tác (L0). |
