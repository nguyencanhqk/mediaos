# S19-QA-FETESTNET-1 — lưới chặn mạng toàn cục cho test FE

Gate LIGHT, chỉ hạ tầng test. Đích: spec nào để lọt `fetch` thật ⇒ ĐỎ kèm URL; lưới tự kiểm là nó còn bật.

## 1. Kết quả đo (chế độ chỉ ghi `FETCH_GUARD=record`, 09/11, cả suite)

`apps/app` (476 file): **12 spec lọt**, 0 lần tự kiểm hỏng. Lượt đo 07/11 (11/12 lô) thấy 8 spec; lượt đủ
thấy thêm 4 (layout, CompanyProfilePage, TaskDetailContent.discuss, TaskKanbanPage.card).

| Spec (dưới `apps/app/src/`) | Lời gọi | URL lọt | Vá |
| --- | --- | --- | --- |
| components/chat/ConversationPanel.spec.tsx | 36 | chat/rooms/:id/members, /typing | `chatApi.listMembers` + `pingTyping` |
| components/chat/ChatDrawer.spec.tsx | 22 | chat/rooms/:id/members | `listMembers` |
| routes/notifications/notifications-router-flow.spec.tsx | 18 | company/branding, me/avatar | `brandingApi` + `meApi.getAvatar` |
| routes/chat/ChatPage.spec.tsx | 12 | chat/rooms/:id/members | `listMembers` + `pingTyping` |
| routes/chat/ChatPage.responsive.spec.tsx | 11 | chat/rooms/:id/members | như trên |
| components/chat/MessageComposer.spec.tsx | 10 | chat/rooms/:id/typing | `pingTyping` |
| test/layout.spec.tsx | 8 | company/branding, me/avatar | `brandingApi` + `meApi` |
| routes/leave/leave-public-holidays-route.spec.tsx | 6 | company/branding, me/avatar | như trên |
| routes/system/foundation/CompanyProfilePage.spec.tsx | 2 | company/branding | `brandingApi.getBranding` |
| routes/tasks/TaskDetailContent.discuss.spec.tsx | 2 | projects/:id/states | `taskStatesApi.listStates` |
| routes/hr/employees/EmployeeDetailPage.spec.tsx | 1 | auth/users/user-001 | `authUsersApi.getUser` (treo) |
| routes/tasks/TaskKanbanPage.card.spec.tsx | 1 | tasks/task-001/subtasks | `taskCoreApi.listSubtasks` |

`ProtectedShell.spec.tsx` (mock `useBrandingQuery` từ #659): 0 lọt. Không spec nào của #580/#600 lọt ⇒
không phải đụng tệp của hai PR đó.

`apps/auth`: 0 lọt ⇒ cài lưới. `apps/console`: 1 spec lọt, `routes/root-layout.spec.tsx` (3 lời gọi
`company/branding`) nằm NGOÀI `paths` ⇒ KHÔNG cài lưới ở console (sẽ đỏ), ghi nợ §4.

## 2. Thiết kế

- `src/test/fetch-net-guard.ts` (logic thuần) + khối cuối `src/test/setup.ts`.
- `setup.ts` chạy một lần mỗi tệp spec, TRƯỚC khi spec nạp: `globalThis.fetch = guard` (luôn từ chối + ghi sổ
  URL). Cài ở mức module chứ không `beforeEach` để không đè `fetch` giả mà spec khai ở mức module/`beforeAll`.
- Spec cần `fetch` giả TỰ khai trong file (`vi.stubGlobal("fetch", vi.fn(...))` hay `vi.spyOn`); lưới coi
  `fetch` hợp lệ khi nó là lưới HOẶC một mock vitest (`vi.isMockFunction`). Cùng tồn tại với bản chép tay trong
  `PostDetailPage.post-switch.spec.tsx` (thuộc #580, không đụng).
- `afterEach` của setup đăng ký trước mọi hook của spec ⇒ chạy SAU CÙNG (vitest `sequence.hooks: "stack"`):
  spec đã `unstubAllGlobals` xong mới đối chiếu. Hai phép: (a) sổ lọt phải rỗng, (b) tự kiểm: `fetch` là lưới
  hoặc mock. Gỡ dòng cài lưới ⇒ (b) đỏ; `vi.stubGlobal` của spec không làm hỏng (b) vì mock được chấp nhận.
- `vitest.config.ts` không bật `unstubGlobals`/`restoreMocks`; spec tự gọi `vi.unstubAllGlobals()` trả `fetch`
  về giá trị lúc stub đầu tiên = lưới (vì setup đã cài trước).
- Mock mới trong spec dùng hàm thường, không `vi.fn()`, ở chỗ spec có `vi.restoreAllMocks()` (vi.fn bị trả về rỗng).
- Không allowlist theo tệp, không nới lưới. `FETCH_GUARD=record` + `FETCH_GUARD_LOG=<đường dẫn>` chỉ để ĐO.
- Chỉ phủ `fetch` (XMLHttpRequest/WebSocket không đi qua đây).

## 3. done_when → test

| Đích | Chứng cứ |
| --- | --- |
| Ca để lọt fetch ⇒ ĐỎ kèm URL | `src/test/fetch-net-guard.spec.ts` › «DENY: ca để lọt…» + «apiFetch không mock…» |
| Lưới tự kiểm đang bật | «DENY: fetch không còn là lưới…» + «fetch toàn cục LÀ lưới» |
| Mutant: gỡ dòng cài | Đã thử 09/11: comment `globalThis.fetch = netGuard.guard` ⇒ cả 7 ca của spec đỏ với «TỰ KIỂM HỎNG»; đã `sed` trả lại |
| Cả suite xanh | `@mediaos/app` 476/476 file (chunk-test) · auth 7/7 · console 23/23 · typecheck app + auth · eslint tệp đã sửa |

## 4. Nợ

- `apps/console/src/routes/root-layout.spec.tsx` lọt `company/branding` ×3 (mock `brandingApi.getBranding`),
  sau đó cài lưới ở `apps/console/src/test/` (chép module + khối cuối setup như auth). Cần WO tiếp (ngoài paths).
- `SocialPortalShell.hr-widget.spec.tsx` còn giữ `fetchMock` riêng vì `observe()` đưa số lời gọi vào object
  so sánh của ca DENY; lưới toàn cục phủ thay được nhưng đổi cấu trúc ca ⇒ để lượt sau (cùng nhóm #580).
- `apps/auth` giữ BẢN CHÉP của `fetch-net-guard.ts` (không sửa `packages/*`); đổi một nơi phải đổi nơi kia.

## 5. Sổ vết (vá review 09/11)

- [LOW] Lưới bỏ sót lời gọi ngoài cửa sổ beforeEach..afterEach — VÁ: bỏ `reset()` ở `beforeEach`; sổ tích luỹ, `take()` rút ở `afterEach` + thêm `afterAll`; mỗi lời gọi mang nhãn ca LÚC GỌI (`during`). Đỏ→xanh: spec thăm dò tạm (fetch ở `beforeAll` + `afterAll`) XANH trên mã cũ, ĐỎ trên mã mới (cả hai URL bị nêu); thêm ca vĩnh viễn «lời gọi từ beforeAll/giữa ca vẫn nằm trong sổ» ở `fetch-net-guard.spec.ts` (app + auth). Suite app 476/476 vẫn xanh (không còn lọt ngoài cửa sổ cũ). Phép đo `FETCH_GUARD=record` dùng cùng đường ⇒ con số «12 spec lọt» là cận dưới của lượt cũ, lượt đo lại không thêm ca.
- [LOW] Header `fetch-net-guard.ts` nói cài lưới ở `beforeEach` — VÁ: sửa thành «mức module + afterEach/afterAll», cả bản app và bản chép ở auth; ghi giới hạn nhãn `during` (lời gọi giữa ca mang tên ca vừa xong).
