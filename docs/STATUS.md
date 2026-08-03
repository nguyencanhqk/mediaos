# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-08-02 18:45Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S7-CHAT-BE-3 — Đính kèm tệp/ảnh qua FOUNDATION Files + ChatMessageFileResolver (BẮT BUỘC — FilePolicy fail-closed, thiếu resolver là tính năng chết trong im lặng)
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/chat/**`, `apps/api/src/foundation/files/**`, `apps/api/test/integration/**`, `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`, `docs/plans/S7-CHAT-BE-3.md`
- **phụ thuộc**: S7-CHAT-BE-2✓
- **done_when (đích hội tụ)**:
  - [ ] ChatMessageFileResolver đăng ký additively ở ChatModule.onModuleInit (KHÔNG đụng app.module.ts), moduleCode 'CHAT' + entityType 'chat_message'
  - [ ] canView/canDownload ⇐ cặp view:chat-room (TRÙNG cặp đường đọc tin — tách cặp riêng sẽ đẻ role 'tải được mà đọc không được') VÀ assertMember phòng chứa tin
  - [ ] canLink ⇐ send:chat-message VÀ người gọi là NGƯỜI ĐÃ TẢI LÊN chính tệp đó — chốt tại nguồn, chặn mượn kênh chat phát tán CCCD/hợp đồng của người khác (đúng cửa hậu đã bịt ở branding)
  - [ ] Tạo file_links trong CÙNG transaction với INSERT tin nhắn; attachment_count DAT NGAY TRONG CAU INSERT tin nhắn (= fileIds.length), CẤM UPDATE sau — app role KHÔNG có quyền cột này (chat_messages chỉ SELECT,INSERT + column-GRANT 4 cột) ⇒ UPDATE = MỌI TIN CÓ TỆP TRẢ 500. 'Cùng transaction' KHÔNG cấp quyền; tệp chưa quét virus xong hoặc Infected → CHAT-ERR-015
  - [ ] GET /rooms/:id/files trả URL ký hạn ngắn sau assertMember; ảnh có biến thể thumbnail
  - [ ] KHÔNG ghi chat_messages.file_url/file_name (cột khai tử); đường đọc trả null
  - [ ] RED-trước: gỡ đăng ký resolver → mọi đường tải 403 (chứng minh fail-closed là thật, không phải giả định) · người ngoài phòng tải bằng fileId trực tiếp → từ chối · gắn tệp người khác → từ chối
  - [ ] FULL gate PASS
  - [ ] ⚠️ ĐÍNH CHÍNH lúc thi công 03/08/2026 — 3 điểm lệch với dòng done_when ở trên, ghi lại để reviewer đối chiếu ĐÚNG hiện thực chứ không đúng dự định:
  - [ ] (a) THUMBNAIL: repo KHÔNG có pipeline sinh biến thể ảnh (không thư viện xử lý ảnh, không job, không khoá biến thể trong storage — đã quét toàn apps/api/src). DTO có khoá `thumbnailUrl` với ngữ nghĩa 'URL xem-trước': ảnh → CHÍNH URL bản gốc (FE co bằng CSS), không-phải-ảnh → null. Biến thể resize THẬT là WO riêng (ngoài paths của WO này). Giới hạn ghi trong jsdoc contracts + micro-plan §1.6
  - [ ] (b) 'MỌI đường tải 403' đúng cho đường FOUNDATION (GET /foundation/files/:id/download → 403). Đường CHAT (DTO tin + tab Tệp) fail-soft: trả `url: null` + logger.error, KHÔNG ném — một tệp hỏng không được làm trắng cả trang tin. Cùng tính chất fail-closed (không có URL nào được ký), khác hình dạng phản hồi. Cả hai đi qua CÙNG decideForLinkedFile
  - [ ] (c) canLink có VẾ THỨ BA ngoài spec: người gọi phải là NGƯỜI GỬI tin đích. Thêm điều kiện cần, không nới lỏng vế nào. Lý do: attachment_count không có GRANT UPDATE ⇒ mọi link gắn sau qua route FOUNDATION làm DTO tin lệch VĨNH VIỄN với tab Tệp, và không có nó thì bất kỳ ai giữ send:chat-message cũng chèn được tệp vào phát ngôn người khác (micro-plan §1.2)
  - [ ] PHÁT SINH: ChatModule phải import StorageModule TƯỜNG MINH (FilesModule chỉ import, KHÔNG re-export STORAGE_ADAPTER) — thiếu là AppModule SẬP lúc khởi động, đỏ dây chuyền mọi int-spec chứ không riêng CHAT

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S7-CHAT-BE-4` Tìm kiếm toàn văn tiếng Việt (có dấu/không dấu) — LUÔN giới hạn theo phòng người tìm là thành viên; đây là đường đọc RỘNG NHẤT của module
- 🔴 `S7-CHAT-BE-5` Phòng tự động theo phòng ban + dự án: tạo/đóng phòng, đồng bộ thành viên tại sự kiện HR/TASK (thu hồi chạy TRONG tx nguồn), job đối soát định kỳ idempotent sửa lệch
- 🟡 `S7-CHAT-BE-6` Thông báo CHAT qua OutboxNotificationBridge: mention gửi ngay + DM gộp lô 15 phút khi vắng mặt; tôn trọng muted_until; payload KHÔNG chứa nội dung tin
- 🔴 `S7-CHAT-RT-0` Hạ tầng WS: GẮN ValkeyIoAdapter (hiện định nghĩa rồi nhưng KHÔNG chỗ nào dùng) — Socket.IO đang chạy in-memory và KHÔNG có CORS ⇒ trình duyệt không nối được
- 🔴 `S7-CHAT-RT-1` Realtime CHAT: join phòng SERVER-SIDE lúc handshake (không nhận danh sách từ client) · emit SAU commit · đồng bộ join/leave ngay khi membership đổi · giữ WS một chiều

**CHỜ (kẹt phụ thuộc):**
- `S7-CHAT-FE-1` Nền FE chat: contracts + api-client + store Zustand dùng chung + MỘT kết nối WS duy nhất cho toàn app shell (trang full-screen và panel nổi dùng chung) ⏳ cần: S7-CHAT-RT-1, S7-CHAT-RT-0
- `S7-CHAT-FE-2` Trang /chat full-screen: 3 cột (danh sách phòng · hội thoại · thông tin phòng) + tạo nhóm/mở DM + gửi tin/tệp/ảnh + trả lời/ghim/thu hồi + đã xem ⏳ cần: S7-CHAT-FE-1, S7-CHAT-BE-3
- `S7-CHAT-FE-3` Panel chat nổi toàn hệ thống (tối đa 3 hội thoại) + badge tổng chưa đọc trên header + lối vào sidebar, thay lối vào /chat tạm của LMS ⏳ cần: S7-CHAT-FE-2
- `S7-CHAT-FE-4` Màn hình tìm kiếm tin nhắn (nhảy tới tin trong ngữ cảnh) + tab tệp/tin ghim/thành viên trong bảng thông tin phòng ⏳ cần: S7-CHAT-FE-2, S7-CHAT-BE-4
- `S7-CHAT-BE-7` 🔒 Đường đọc-vượt membership (CHAT-DEC-004): controller+service RIÊNG /chat/oversight/*, chỉ đọc, cặp ('view','chat-oversight'), audit trong CÙNG transaction trước khi trả dữ liệu ⏳ cần: S7-CHAT-BE-3
- `S7-CHAT-FE-5` 🔒 Màn quản trị đọc-vượt (CHAT-SCREEN-007) + nhật ký đọc-vượt (CHAT-SCREEN-008) — lối vào tường minh, có bước xác nhận, chế độ chỉ đọc ⏳ cần: S7-CHAT-BE-7, S7-CHAT-FE-2
- `S7-CHAT-QA-1` Bộ test trọn vẹn CHAT: 12 nhóm scenario SPEC-15 §21 trên LANE_DB + E2E luồng tới hạn + coverage ≥80% (vùng membership/tìm kiếm cao hơn) ⏳ cần: S7-CHAT-FE-3, S7-CHAT-BE-5, S7-CHAT-BE-6, S7-CHAT-FE-4, S7-CHAT-FE-5
- `S7-CHAT-CLEAN-1` Contract (release SAU): drop chat_rooms.channel_id + chat_messages.file_url/file_name + composite FK/index kèm theo — chỉ chạy khi đã xác minh 0 hàng và 0 tham chiếu ⏳ cần: S7-CHAT-QA-1

**🛑 BLOCKED:**
- `S6-SEC-IDENTITY-PROJ-1` Gốc rễ của N-1/N-2/N-1c — buộc TẦNG CHIẾU `users.email`/`users.fullName` phải nhận vị từ scope, thiếu thì VỠ TYPECHECK (không phải trả 0 hàng im lặng)
  - **vì sao chặn**: KIEM TRA LAI 03/08 - GIU HOAN. (1) Van CHUA thi cong: 0 docs/plans/S6-SEC-IDENTITY-PROJ-1.md, 0 commit code mang ma WO (3 commit nhac ten deu la chore(docs|gov)), 0 worktree, 0 nhanh. (2) KI-053 + KI-054 VAN MO tren cay…

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S4-QA-2`, `S5-DEVOPS-1`, `S5-QA-E2E-1`, `S5-BE-CONTRACT-1`, `S5-SEC-1`, `S5-QA-REG-1`, `S5-QA-DASHNOTI-1`, `S5-PERF-1`, `S5-UAT-1`, `S6-GOV-1`, `S6-STAB-1`, `S6-QA-FINAL-1`, `S6-SEC-1`, `S6-PERF-DB-1`, `S6-QA-CHUNK-1`, `S6-SEC-ROUTEMAP-1`, `S6-SEC-ORG-1`, `S6-SEC-ORGSCOPE-1`, `S6-SEC-ORGTEAMSCOPE-1`, `S6-SEC-IDENTITYBOUND-1`, `S6-SEC-PERMVERB-1`, `S6-SEC-NOTITX-1`, `S6-SEC-LOGINLOG-1`, `S6-SEC-LOGINLOG-2`, `S6-SEC-XTENANTFK-1`, `S6-SEC-MV-1`, `S6-SEC-DBFENCE-1`, `S6-SEC-ROTATE-1`, `S6-QA-TENANTWRITE-1`, `S6-REL-1`, `S6-GOLIVE-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-ME-BE-2`, `S5-ME-BE-3`, `S5-ME-FE-1`, `S5-ME-FE-2`, `S5-ME-FE-3`, `S5-ME-QA-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-HR-IMPORT-FE-1`, `S5-HR-ORGCHART-BE-1`, `S5-HR-ORGCHART-FE-1`, `S5-HR-WORKINFO-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`, `S5-TASK-DEPTFILTER-1`, `S5-FE-TASK-5`, `S5-FE-TASK-6`, `S5-LEAVE-HOLIDAYS-MOVE-1`, `S5-NOTI-FIX-1`, `S5-NOTI-FIX-2`, `S5-TASK-HRCODE-1`, `S5-LEAVE-DEADCODE-1`, `S5-SEQ-HARDEN-1`, `S5-TASK-PIPELINE-1`, `S5-TASK-NAV-TREE-1`, `S5-TASK-WORKSPACE-1`, `S5-TASK-DETAIL-1`, `S5-TASK-SUBTASK-1`, `S5-DASH-TASKSTATUS-FIX-1`, `S5-TASK-PROJROLE-1`, `S5-TASK-BOARD-UX-1`, `S5-TASK-INLINE-1`, `S5-TASK-AVATAR-1`, `S5-TASK-CARDSUB-1`, `S5-TASK-MOVEPROJ-1`, `S5-TASK-COVER-1`, `S5-GOAL-DOC-1`, `S5-GOAL-DB-1`, `S5-GOAL-BE-1`, `S5-GOAL-BE-2`, `S5-GOAL-FE-1`, `S5-GOAL-FE-2`, `S5-GOAL-DB-2`, `S5-GOAL-TPL-1`, `S5-FND-REVOKE-1`, `S5-GOAL-DASH-1`, `S5-LMS-DB-1`, `S5-LMS-BE-1`, `S5-LMS-BE-2`, `S5-LMS-APP-1`, `S5-LMS-APP-2`, `S5-LMS-APP-3`, `S5-LMS-BE-3`, `S5-LMS-FE-1`, `S5-LMS-BE-4`, `S5-LMS-UI-1`, `S5-LMS-UI-2`, `S5-LMS-UI-3`, `S5-LMS-UI-4`, `S5-LMS-OPEN-DIRECT-1`, `S5-LMS-NOTI-1`, `S5-LMS-NOTI-2`, `S5-FND-THEME-AA-1`, `S5-FND-UI-GEN-1`, `S5-SYS-CLEAN-1`, `S5-DEVOPS-DEPLOYMIG-1`, `S5-BRAND-BE-1`, `S5-BRAND-FE-1`, `S5-BRAND-FE-2`, `S7-GOAL-PROJTAB-1`, `S7-CHAT-DOC-1`, `S7-CHAT-DOC-2`, `S7-CHAT-DB-1`, `S7-CHAT-DB-2`, `S7-CHAT-BE-1`, `S7-CHAT-BE-2`, `S6-OPS-LOGWINDOW-1`, `S6-LEAVE-ACCRUAL-1`, `S6-LEAVE-CARRYOVER-1`, `S6-LEAVE-MAXNEG-1`, `S6-LEAVE-TYPEADMIN-1`

## Trạng thái repo

- **branch**: `wave/s7-chat` · **file đang đổi (dirty)**: 25
- **migration head**: idx 206 — `0539_s7chatdb2_room_seq` (207 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `436a7c61` | 2026-08-03 | fix(harness): chunk-test chia đôi chunk chết thay vì mất trọn phạm vi + đo lại 4 cổng go-live |
| `5365e0d0` | 2026-08-03 | fix(chat): S7-CHAT-BE-GATE-2 — vị từ §13.4 trên MỌI đường đọc + đóng đinh cặp quyền route |
| `8effc061` | 2026-08-03 | docs(chat): neo lại 5 micro-plan wave S7 lên 104294bd + gỡ pseudo-code toàn-thân |
| `104294bd` | 2026-08-03 | docs(chat): CHAT-DEC-013 + 6 micro-plan wave S7 (5 rev 2 + RT-0 mới) + đồng bộ backlog/STATUS |
| `631d683e` | 2026-08-03 | fix(chat): vá FULL gate S7-CHAT-BE-1/BE-2 — 1 HIGH + 5 MEDIUM |
| `54b4d8cd` | 2026-08-02 | feat(chat): S7-CHAT-BE-2 — tin nhắn (CHAT-API-009..014, 016) |
| `c77f48e0` | 2026-08-02 | feat(chat): S7-CHAT-BE-1 — ChatAccessService + phòng/thành viên (CHAT-API-001..008) |
| `4c5c2da6` | 2026-08-02 | feat(chat): S7-CHAT-DB-2 (mig 0539) — room_seq per-room, sửa công thức đếm chưa đọc SAI |
| `7822abd7` | 2026-08-02 | feat(chat): khối (F′) — cấp 10 cặp CHAT cho role đang giữ toàn bộ catalog |
| `d28d69e8` | 2026-08-02 | fix(chat): vá FULL gate cho S7-CHAT-DB-1 — 3 HIGH + 9 MEDIUM |
| `1a6ec20a` | 2026-08-02 | feat(chat): S7-CHAT-DB-1 — nền dữ liệu CHAT v1 (mig 0538) |
| `4072a057` | 2026-08-02 | docs(chat): micro-plan S7-CHAT-DB-1 (rev 2) — vá 5 mục BLOCK của plan-reviewer |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
