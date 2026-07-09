# Micro-plan — S4-FE-REGISTRY-1 (FE registry TASK·NOTI·DASH)

> Reconcile-refresh cho auto-loop. Bake fix BLOCKING của plan-reviewer (run wf_4a728732).
> Bản chất WO: **RECONCILE + mở rộng** (registry base ĐÃ có) — KHÔNG dựng lại, KHÔNG tạo page thật.

```yaml
wo: S4-FE-REGISTRY-1
zone: green
generated_by: hand-authored (post plan-block wf_4a728732)
reconciled_at: "9f4ca6d"
lanes: [{"id":"s4feregistry1-fe","task":"Reconcile+mở rộng registry TASK/NOTI/DASH: xác nhận PERMISSION_CODE_TO_PAIR + APP/ROUTE/SIDEBAR registry base đã có entry đúng cặp BASE non-sensitive; thêm api-client method typed + i18n vi + deny-path test. KHÔNG tạo page thật, KHÔNG sửa allowlist BE","paths":["apps/app/src/routes/**","apps/app/src/layouts/**","apps/app/src/i18n/**","packages/web-core/src/lib/**"],"builder":"frontend-builder"}]
acceptanceChecks: ["PERMISSION_CODE_TO_PAIR (web-core) map cặp BASE non-sensitive: TASK→read:task · PROJECT→read:project · NOTI→read:notification · DASH→read:dashboard — ĐÃ verify seed: read:project/read:task/read:notification ở 0005 (dòng 223/249/268, is_sensitive=false), read:dashboard ở 0100 (false). Mọi cặp scoped/sensitive (view-team task, notification admin-send…) DEFER sang S4-*-SEED-1","tasks-api.ts/notification-api.ts/dashboard-api.ts typed 100% qua @mediaos/contracts, KHÔNG nhận/forward company_id, KHÔNG import token-storage (mirror attendance-api.ts)","registry.spec.ts assert danh sách cặp khớp catalog cụ thể (read:task/read:project/read:notification/read:dashboard)","i18n vi đủ key nhãn module/menu TASK/NOTI/DASH; KHÔNG chuỗi hard-code","KHÔNG sửa SENSITIVE_CAPABILITY_ALLOWLIST (thuộc apps/api — ngoài paths WO); KHÔNG tạo page thật (routes/tasks|notifications|dashboard page = S4-FE-TASK-1…); KHÔNG nhân bản registry đã có","check.sh xanh (typecheck + test + build 3 app); LIGHT gate react-reviewer + quality-gate"]
testTasks: ["deny-path RED (packages/web-core/src/lib/registry.spec.ts, mirror apps/app/src/test/registry-guard.spec.tsx): user KHÔNG có read:task/read:project/read:notification/read:dashboard → evaluateRouteAccess(/tasks,/notifications,/dashboard) KHÔNG ALLOW (SHOW_403/404) + filterSidebarItems ẩn TASK/NOTI/DASH + getVisibleApps ẩn app","allow-path RED: user CÓ đủ cặp → thấy đúng app/route/sidebar TASK/NOTI/DASH","fixtures dùng cặp engine THẬT (read:task…), session.modules + scopes populate THẬT — KHÔNG caps giả"]
steps: ["Đọc packages/web-core/src/lib/registry.ts (APP_REGISTRY/ROUTE_REGISTRY/PERMISSION_CODE_TO_PAIR) + apps/app/src/layouts/workspace/sidebar-registry.ts (DASH_SIDEBAR/TASK_SIDEBAR/NOTI_SIDEBAR) — xác nhận entry base ĐÃ có → reconcile, KHÔNG dựng lại","Viết registry.spec.ts deny-path RED-trước (3 test ở trên)","Thêm api-client method skeleton typed (tasks-api/notification-api/dashboard-api) qua @mediaos/contracts + i18n vi","Xác minh read:project ở 0005 (đã verify dòng 223) trước khi pin mapping TASK.PROJECT.VIEW→read:project","check.sh + LIGHT gate"]
```

## Reconcile notes (prose)

**Bối cảnh block:** (a) `testTasks` rỗng cho lớp permission-gating — đúng lớp gây pair-drift ẩn app ATT/LEAVE với mọi role ở S3 (vá bằng PR #59). (b) phụ thuộc ẩn vào seed TASK/NOTI/DASH chưa build. (c) nghiệm thu mơ hồ. (d) path `apps/app/src/registry/**` **không tồn tại**.

**Fix chốt:**
1. **Path**: bỏ `registry/**` (Glob rỗng), thêm `apps/app/src/layouts/**` (sidebar-registry.ts thật ở đây). Đã sửa trong backlog.
2. **Dependency (chọn phương án ii)**: KHÔNG thêm depends_on 3 SEED WO. Thay vào đó **pin mapping vào cặp BASE đã seed thực tế** — `read:task`/`read:project`/`read:notification`/`read:dashboard` (đều `is_sensitive=false` → KHÔNG bị `getCapabilities` lọc khỏi `/auth/me` → app hiện đúng). WO chỉ khẳng định cặp base non-sensitive; **mọi cặp scoped/sensitive DEFER** sang S4-*-SEED-1 (nơi có quyền append `SENSITIVE_CAPABILITY_ALLOWLIST` ở `apps/api/src/permission/permission.service.ts`).
3. **Nghiệm thu đo được**: thay 'skeleton'/'FE spec' mơ hồ bằng tiêu chí cụ thể (typed 100% qua contracts, không forward company_id, không import token-storage; registry.spec.ts assert danh sách cặp cụ thể).
4. **Scope**: registry base (APP/ROUTE/SIDEBAR + PERMISSION_CODE_TO_PAIR) **đã có sẵn** entry TASK/NOTI/DASH → WO = reconcile + thêm api-client/i18n/test. **Bỏ** từ 'action registry' (không tồn tại trong registry.ts) tránh scope-creep. KHÔNG tạo page thật (thuộc S4-FE-TASK-1/NOTI-1/DASH-1). Vì paths chỉ FE, tuyệt đối không gate route/sidebar bằng cặp sensitive (không vá được allowlist trong WO).

**Bất biến:** #3 — chỉ dùng cặp base non-sensitive; masking server-side (client render metadata nhận được). Không đụng DB/BE.
