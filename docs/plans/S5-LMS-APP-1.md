# S5-LMS-APP-1 — Chuẩn hoá UI LMS (track LOCAL)

> Zone: **yellow** · Gate: LIGHT (typescript-reviewer + quality-gate) · Track: **LOCAL** (`apps/lms/**` NGOÀI git MediaOS)
> Wave: `docs/plans/S5-LMS-WAVE.md` §4 **B05** · depends_on: — (WO đầu tiên của track LOCAL)
> Ship = sửa tại chỗ ở main worktree → build → **NSSM restart `MediaOS-LMS`** (không PR/CI).

---

## 1. Vấn đề hiện tại (đã verify bằng đọc code, không phỏng đoán)

| # | Hiện trạng | File |
| --- | --- | --- |
| 1 | `/` là **landing marketing** (hero "Better video, better life" + 4 card feature). Người đã đăng nhập vào `/` thấy lời chào + nút "Đi tới trò chuyện" → `/chat`, KHÔNG phải học tập | `app/(public)/page.tsx` |
| 2 | Sau đăng nhập (mật khẩu **và** verify OTP) đá về `/` = landing | `app/(auth)/login/_components/LoginForm.tsx:60,84` · `login/page.tsx:12` · `register/page.tsx:9` · `forgot-password/page.tsx:9` · `RegisterForm.tsx:94` |
| 3 | SSO từ MediaOS mặc định đáp xuống `/dashboard` (không phải `/course`) | `app/api/auth/sso/route.ts:58` |
| 4 | Sidebar có **khu HR placeholder** 9 mục (overview/profile/attendance/requests/**salary/benefits/uniform/assets**/performance) — trang rỗng, không thuộc phạm vi LMS | `components/sidebar/app-sidebar.tsx:206-252` (`employeeNavMain`) |
| 5 | `hubNavMain` (6 mục `/hub/*`) là **code chết**: chỉ kích hoạt khi `pathname.startsWith("/chat")`, mà đúng điều kiện đó `hideSidebar=true` → `return null`. Ngoài ra **`/hub/*` không tồn tại** (404) | `app-sidebar.tsx:55-56, 173-204, 262-264` |
| 6 | App-switcher (lưới ứng dụng ở header) có **9 tile, 5 tile 404**: `hr`→`/hub/attendance`, `work`, `social`, `process`, `salary` — các route này KHÔNG tồn tại trong cây `app/` | `components/sidebar/app-tile.tsx:37-122` |
| 7 | Không có lối vào `/dashboard` ("Khóa học của tôi") từ sidebar — chỉ vào được qua menu trong header | `app-sidebar.tsx:108-156` |
| 8 | Logo sidebar + site-header link về `/` (landing) | `app-sidebar.tsx:281` · `site-header.tsx:52` |

**Đã đúng sẵn, KHÔNG cần sửa:** `/dashboard` đã hiển thị nhãn "Khóa học của tôi" — `dashboard/page.tsx` truyền `heading="My Learning"`, `CourseList.tsx:82` map sang `t(language,"myLearning")` = `"Khóa học của tôi"` (`i18n/vi.ts:82`). WO chỉ cần **giữ nguyên + mở lối vào**, không đổi chuỗi.

## 2. Phạm vi thay đổi

### A. `/` hết landing (điểm 1)
`app/(public)/page.tsx` → server component thuần redirect:
- có phiên (`getSessionFromCookies()`) → `redirect("/course")`
- chưa có phiên → `redirect("/login")`

Giữ nguyên `app/(public)/layout.tsx` + `_components/Navbar.tsx` (không xoá code — `redirect()` throw trước khi render nên layout không chạy).

### B. Mọi đường vào đều đáp xuống `/course` (điểm 2, 3, 8)
- `login/page.tsx` · `register/page.tsx` · `forgot-password/page.tsx`: đã-có-phiên → `/course` (thay `/`)
- `LoginForm.tsx:60,84` · `RegisterForm.tsx:94`: `router.push("/course")`
- `api/auth/sso/route.ts:58`: `nextPath` mặc định `/dashboard` → **`/course`** (logic validate origin nội bộ GIỮ NGUYÊN — không đụng phần chống open-redirect)
- logo sidebar + site-header: `href="/course"`

### C. Sidebar sắp lại (điểm 4, 5, 7)
- `navMain`: **Khoá học** (`/course`) → **Khóa học của tôi** (`/dashboard`, `t(language,"myLearning")`) → Bài thi → Xếp hạng/quản trị nội dung (giữ nguyên thứ tự + điều kiện permission sẵn có)
- **XOÁ `employeeNavMain`** + nhánh `isEmployee` (khu HR placeholder). Route `/employee/*` KHÔNG xoá — chỉ ẩn khỏi nav.
- **XOÁ `hubNavMain`** + `isHub` (code chết, trỏ vào 404)
- Gỡ import icon thừa sau khi xoá
- `adminNavMain` + `sidebarStyle` cho `/admin`: **GIỮ NGUYÊN** theo permission (`canManageUsers`/`canManageRoles`/`MANAGE_RAG`/`isAdmin`)

### D. App-switcher — bỏ tile 404 (điểm 6)
`APP_KEYS` giữ lại `learning` · `chat` · `config`; bỏ `hr`/`employee`/`work`/`social`/`process`/`salary`.
`APP_STATIC`/`getAppTitle`/`findMatchingApp` **giữ nguyên định nghĩa** (không xoá code, chỉ thu hẹp danh sách hiển thị) — nếu sau này dựng route thật thì thêm key lại vào `APP_KEYS`.
`config` → `/admin` vẫn tự guard theo permission phía server (`admin/page.tsx` redirect khi thiếu quyền) ⇒ "admin giữ nguyên theo permission" thoả.

> Ghi chú phạm vi: mục D nằm ngoài chữ "sidebar" của tiêu đề WO nhưng thuộc `done_when` "chuẩn hoá UI" — 5 tile 404 hiển thị cho mọi user là lỗi UX thật, sửa = thu hẹp 1 mảng. Ghi rõ trong commit/handoff.

### Ngoài phạm vi (KHÔNG làm)
Xoá code chat/AI/call · đổi i18n `myLearning` · đụng authz từng trang (`getSessionFromCookies` pattern) · middleware · SSO-only (đó là APP-2) · API tiến độ (APP-3).

## 3. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Đá `/`→`/login` làm hỏng SSO (SSO đáp thẳng `/course`, không qua `/`) | Smoke SSO end-to-end sau restart |
| Vòng lặp redirect `/` ↔ `/login` nếu đọc phiên lỗi | `/login` chỉ redirect khi CÓ phiên; `/` chỉ redirect khi KHÔNG có phiên ⇒ không thể lặp |
| Mất lối vào trang HR placeholder | Có chủ ý (WO yêu cầu ẩn); route vẫn gõ URL vào được |
| Deploy làm hỏng DB SQLite live (34+ user thật) | **Backup `data/app.db` TRƯỚC restart** (`pnpm backup:db` hoặc copy tay theo ngày) |
| Build đỏ sau khi gỡ import | `npx tsc --noEmit` + `next build` trước khi restart NSSM |

## 4. Verify (thay cho CI)

1. `npx tsc --noEmit` + `pnpm build` xanh
2. Backup `data/app.db`
3. `nssm restart MediaOS-LMS` (hoặc `Restart-Service MediaOS-LMS`)
4. Smoke: `/` chưa phiên → 307/302 `/login` · `/login` 200 · `/api/auth/sso` sai chữ ký → 401 · đăng nhập SSO từ MediaOS → đáp `/course` · `/course` + `/dashboard` + `/exam` mở được · sidebar không còn khu HR
5. Review LIGHT gate: typescript-reviewer đọc diff local

## 5. Done

Theo `done_when` của WO trong `harness/backlog.mjs` (S5-LMS-APP-1).

---

## 6. Kết quả thi công (2026-07-23) — SHIPPED

**File đã sửa (11):** `(public)/page.tsx` · `(auth)/{login,register,forgot-password}/page.tsx` ·
`(auth)/login/_components/LoginForm.tsx` (2 chỗ) · `(auth)/register/_components/RegisterForm.tsx` ·
`(auth)/layout.tsx` · `api/auth/sso/route.ts` · `components/sidebar/{app-sidebar,site-header,app-tile,app-switcher}.tsx` ·
`app/docs/layout.tsx` · `(app)/course/[slug]/_components/CourseDetailView.tsx`.

**LIGHT gate (typescript-reviewer): PASS** — 0 CRITICAL / 0 HIGH. 2 MEDIUM phát hiện được **vá ngay trong WO**:

1. `app-switcher.tsx` `useRecentApps` chỉ lọc allowlist lúc ĐỌC localStorage, không lọc lúc GHI ⇒
   vào thẳng URL `/employee/*` (route còn sống, chỉ ẩn khỏi nav) sẽ đẩy key `employee` vào khay
   "Gần đây" → tile HR hồi sinh trong khi "Tất cả ứng dụng" không có ⇒ 2 danh sách lệch nhau.
   **Vá:** `if (!matched || !VALID_APP_KEYS.has(matched)) return;`
2. `(auth)/layout.tsx:20` logo còn `href="/"` — layout này CHỈ render khi chưa có phiên ⇒ bấm logo ở
   `/register`·`/forgot-password` bị đá về `/login` một cách vô nghĩa. **Vá:** `href="/login"`.

2 LOW (hop redirect thừa) cũng vá luôn: `app/docs/layout.tsx` "← Quay lại ứng dụng" và breadcrumb
"Home" ở `CourseDetailView.tsx` → trỏ thẳng `/course` thay vì `/` .

**Verify trên PROD thật** (`https://train.funtimemediacorp.com`, phiên thật mint qua SSO):

| Ca | Kết quả |
| --- | --- |
| `/` chưa phiên | 307 → `/login` ✅ |
| `/` có phiên | 307 → `/course` ✅ |
| `/login` | 200 ✅ |
| `/course` · `/dashboard` · `/exam` có phiên | 200 ✅ |
| SSO token hợp lệ | 302 → **`/course`** + `referrer-policy: no-referrer` ✅ |
| SSO token sai | 401 ✅ |
| SSO token dùng lại (replay) | 401 ✅ (jti một-lần còn nguyên) |
| HTML sidebar có phiên | có `/course` · `/dashboard` "Khóa học của tôi" · `/exam`; **KHÔNG** còn `/employee/*`, `/hub/*`, "Đồng phục" ✅ |

`npx tsc --noEmit` · `npx eslint` (file đụng) · `next build` xanh cả 2 vòng. Backup `data/app.db`
(55 MB, qua SQLite backup API — WAL-safe, KHÔNG dùng `cp`) trước mỗi lần restart NSSM.

**Ghi chú bàn giao:** 5 phiên smoke của tài khoản `ng.canh9x@gmail.com` (06:26–06:29 UTC 23/7) chưa
dọn — lệnh ghi vào DB LMS live bị chặn; phiên tự hết hạn, vô hại.

**Đường vào `/` khi CÓ phiên đổi hành vi:** trước đây `/` là landing với nút "Đi tới trò chuyện"
(`/chat`); nay `/` → `/course`. `/chat` vẫn vào được qua app-switcher (tile Trò chuyện giữ nguyên).
