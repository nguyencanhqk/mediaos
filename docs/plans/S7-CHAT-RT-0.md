# Micro-plan — `S7-CHAT-RT-0` (🔴 red · FULL gate)

> **WO:** Gắn `ValkeyIoAdapter` — hiện định nghĩa đầy đủ nhưng **0 chỗ nào gọi** `app.useWebSocketAdapter(...)`. Hệ quả: Socket.IO chạy in-memory, **không có CORS** trên `/ws` (browser không nối được), và không broadcast được xuyên instance.
> **Nguồn sự thật:** `harness/backlog.mjs` entry `S7-CHAT-RT-0` (`src`/`done_when`) · SPEC-15 (bối cảnh CHAT dùng chung namespace `/ws`).
> **Nhánh:** `wo/s7-chat-rt0` → PR vào `wave/s7-chat` (❗KHÔNG `master` — `docs/plans/S7-CHAT-WAVE.md` §4), auto-merge TẮT.
> **Phụ thuộc:** `depends_on: []`. **Phải land TRƯỚC `S7-CHAT-FE-1`** — `S7-CHAT-FE-1.depends_on` liệt kê đích danh `"S7-CHAT-RT-0"` (`harness/backlog.mjs:9816`), vì FE-1 là lần đầu tiên có `socket.io-client` chạy trong TRÌNH DUYỆT (`apps/app`) — nếu CORS `/ws` chưa được gắn, FE-1 dựng xong store/provider WS xong vẫn **không kết nối được**, và lỗi sẽ trông giống bug FE ("connect_error: xhr poll error") trong khi gốc nằm ở BE chưa gắn adapter. Vá gốc trước thì FE-1 không phải tự chẩn đoán lại đúng cái lỗ này.
>
> **Re-anchor (03/08/2026):** đo lại toàn bộ trích dẫn ở HEAD `104294bd` (chính là commit đã thêm plan này — chưa có commit nào sau đó trên `wave/s7-chat`; `631d683e` "vá FULL gate BE-1/BE-2" là CHA trực tiếp, đã nằm sẵn trong lịch sử, không phải commit mới thêm). `git status --short` sạch. `main.ts` + `realtime/**` (và mọi file khác được trích ở §0) **không đổi** kể từ khi plan viết — toàn bộ trích dẫn cũ đã được đối chiếu lại nguyên trạng; 3 chỗ sửa ở §0 (dòng `useGlobalPipes/…`, dòng `VALKEY_URL`, dòng grep shutdown-hook) là lỗi đo có sẵn từ bản gốc, không phải do code trôi.
>
> **Mục BLOCK thiết kế reviewer đã nêu — CÒN MỞ, KHÔNG vá ở pass re-anchor này:** chuỗi bằng chứng CORS dựng trên tiền đề sai về engine.io (cors middleware không bao giờ từ chối, chỉ bỏ header ACAO) · test dùng chung kênh pub/sub với PROD · rò client ioredis ở nhánh connect lỗi · `isMultiInstanceReady()` là ảnh chụp lúc boot · smoke trình duyệt không cưỡng chế được · int-spec phụ thuộc env. **Nghiêm trọng nhất:** gắn adapter khi **4 môi trường** (`.env` gốc, `apps/api/.env` test-only, `.env.dev`, `.env.prod` — đo lại 03/08: cả 4 đều có `VALKEY_URL=redis://localhost:6379`) dùng chung một Valkey, và `createAdapter(pubClient, subClient)` ở `valkey-io.adapter.ts:47` gọi KHÔNG truyền `opts.key` (mặc định channel prefix `"socket.io"` — xác nhận ở `@socket.io/redis-adapter@8.3.0` `RedisAdapterOptions.key`) ⇒ mọi môi trường phát/nhận trên CÙNG namespace pub/sub, int-spec (§4, ca 8-11) chạy trên máy dev có thể nối vào đúng kênh mà PROD/`.env.dev` đang dùng.

---

## 0. Đo thật trước khi thiết kế (02/08/2026)

| Thứ | Đo được | Nguồn |
| --- | --- | --- |
| `ValkeyIoAdapter` **chưa từng được wire** | grep repo `ValkeyIoAdapter\|useWebSocketAdapter` = 3 hit, cả ba nằm trong chính `valkey-io.adapter.ts` (định nghĩa class + JSDoc). `apps/api/src/main.ts` **không** gọi `app.useWebSocketAdapter(...)` ở đâu | grep toàn repo |
| `main.ts` trình tự bootstrap hiện tại | `enableCors` (HTTP) dòng 41-44 → `useGlobalPipes/Interceptors/Filters` 47-49 (dòng 46 chỉ là comment) → `setupSwagger` 53 → `app.listen(env.API_PORT)` 55. **Không** có bước gắn WS adapter nào | `apps/api/src/main.ts:27-63` |
| `createIOServer()` override — nơi DUY NHẤT set CORS cho Socket.IO | đọc `env.CORS_ORIGIN` **tách theo dấu phẩy + trim**, set `{origin, credentials:true}` merge vào `options`, rồi `server.adapter(this.adapterConstructor)` NẾU connect Valkey thành công | `apps/api/src/realtime/valkey-io.adapter.ts:60-71` |
| `connectToValkey()` hiện **fail-soft ÂM THẦM** | connect lỗi → `this.logger.**warn**(...)` rồi tiếp tục với `adapterConstructor = null` (in-memory). KHÔNG throw, KHÔNG đánh dấu trạng thái nào cho caller đọc được | `valkey-io.adapter.ts:50-57` (dòng 51 = `logger.warn`) |
| `@WebSocketGateway({namespace: WS_NAMESPACE})` **không tự set cors** | decorator chỉ truyền `{namespace: "ws"}` — không có field `cors` nào bị adapter override đè lên phải giải quyết xung đột; `{...options, cors}` trong `createIOServer` luôn thắng | `apps/api/src/realtime/realtime.gateway.ts:39` · `packages/contracts/src/realtime.ts:13` |
| **Khung NestJS: thứ tự gọi `useWebSocketAdapter` là bắt buộc, có warning tường minh trong chính framework** | `nest-application.js#useWebSocketAdapter()`: nếu `isWsModuleRegistered===true` thì log warn *"…called after WebSocket gateways were already initialized… call app.useWebSocketAdapter(...) BEFORE app.init() (or app.listen())."* `isWsModuleRegistered` được set `true` bên trong `registerWsModule()`, gọi từ `registerModules()`, gọi từ `init()`; `listen()` tự gọi `init()` nếu `!isInitialized`. ⇒ Chỉ cần gọi `useWebSocketAdapter` **bất kỳ lúc nào trước `app.listen()`** (không cần ngay sau `NestFactory.create`) | `@nestjs/core@11.1.24/nest-application.js:256-262` (warning) · `:80-93` (`registerModules→registerWsModule`) · `:174-178` (`listen()` gọi `init()`) — bản cài xác nhận ở `apps/api/package.json` |
| **`ValkeyIoAdapter` hiện có 0 test** | glob `apps/api/src/realtime/*` không có `valkey-io.adapter.spec.ts` nào — class sống trong tree từ đầu mà chưa từng được unit-test, không riêng gì việc chưa được wire | `Glob apps/api/src/realtime/*` |
| `CORS_ORIGIN` — dạng & giá trị thật | schema: chuỗi, default `http://localhost:5273`, tách bởi dấu phẩy ở cả `main.ts` lẫn adapter. Dev (`.env` gốc, `apps/api/.env` KHÔNG override field này): `http://localhost:5273,http://web.localhost:5273,http://auth.localhost:5275,...`. PROD (`.env.prod`): `https://funtimemediacorp.com,https://auth.funtimemediacorp.com,https://console.funtimemediacorp.com` | `apps/api/src/config/env.schema.ts:39` · `.env:90` · `.env.prod:74` |
| Precedence file env | `apps/api/.env` (đứng trước, thắng) rồi `../../.env` (root) — field đứng trước thắng theo key, KHÔNG theo file toàn phần. `apps/api/.env` không có `CORS_ORIGIN` ⇒ giá trị dev thật tới từ root `.env` | `apps/api/src/config/env.schema.ts:8` (`ENV_FILE_PATHS`) · `config/load-env.ts:34-37` |
| `VALKEY_URL` | `optionalUrl()` — rỗng ⇒ `undefined` (không throw). Local dev: `redis://localhost:6379`. **Sửa 03/08:** nguồn KHÔNG chỉ root `.env:32` — `apps/api/.env:8` (gitignore, test-only overrides, tự comment "Vitest loads this from `root: \".\"` … Takes precedence over root .env for test runs") **cũng** khai `VALKEY_URL=redis://localhost:6379` (giống hệt giá trị), và `apps/api/vitest.config.ts` đặt `envDir: "."` (cwd = `apps/api`) ⇒ khi chạy `pnpm --filter @mediaos/api test`, `apps/api/.env` mới là file THẮNG cho biến này (không phải root `.env` như dòng "Precedence file env" phía trên có thể gợi ý nếu đọc lướt) — cùng giá trị nên hành vi KHÔNG lệch hôm nay, nhưng đây chính là file cần sửa nếu sau này muốn cô lập kênh Valkey của test khỏi kênh dev/PROD. Valkey **1 instance dùng chung** qua `docker-compose.yml:98-108`, **không** lane-isolated như Postgres — `scripts/lane-db-setup.sh` không có dòng nào nhắc Valkey | `env.schema.ts:55` · `.env:32` · `apps/api/.env:8` (không tracked git) · `apps/api/vitest.config.ts` (`envDir: "."`) · `docker-compose.yml:98-108` |
| `REALTIME_ENABLED` | mặc định `"true"`, kill-switch riêng biệt với chuyện CORS/adapter — gateway `afterInit` từ chối MỌI connection ở handshake khi `false`, không liên quan gì tới việc adapter có wire hay không | `env.schema.ts:57-59` · `realtime.gateway.ts:44,54-60` |
| **FE hiện KHÔNG có bất kỳ WS client nào** | grep `socket.io|notification:new|WS_NAMESPACE|io(` trong `apps/app/src`, `apps/auth`, `apps/console` = **0 hit**. `socket.io-client` chỉ là devDependency của `apps/api` (dùng cho `realtime.gateway.io.spec.ts`, client Node) | `Grep apps/{app,auth,console}/src` · `apps/api/package.json:64` |
| ⇒ Hệ quả cho done_when #4 ("mở apps/app, thấy 1 kết nối /ws") | **Chưa đúng theo nghĩa đen hôm nay** — `apps/app` chưa có dòng code nào mở socket. Smoke trình duyệt của WO này PHẢI dùng một harness tĩnh tạm thời (§6), không phải "mở app rồi nhìn" | suy từ dòng trên |
| 2 spec đang phủ gateway, **không đụng `main.ts`** | `realtime.gateway.io.spec.ts` tự dựng `http.createServer()` + `new Server(httpServer)` trần — **không** qua `NestFactory`/adapter nào, nên đổi bootstrap ở `main.ts` KHÔNG làm gãy 2 file này. Chúng cũng không chứng minh được CORS (client Node không thực thi CORS) | `realtime.gateway.io.spec.ts:39-68` |
| Không có int-spec nào từng boot `AppModule` thật + `socket.io-client` thật | grep `socket.io-client\|ioClient\|RealtimeGateway` trong `apps/api/test/**` = 0 hit — WO này là lần ĐẦU có test loại này | `Grep apps/api/test` |
| Không có `enableShutdownHooks()`/SIGTERM handler nào trong `main.ts` | `disconnectValkey()` (method có sẵn trên adapter) hiện **mồ côi**, không nơi nào gọi — độc lập với việc adapter có được wire hay không, ngoài phạm vi done_when của WO này | **Sửa 03/08 — pattern cũ đo sai:** grep LITERAL `enableShutdownHooks\|SIGTERM` trong `apps/api/src` = **0 hit** (không phải 1 như bản gốc ghi). Grep rộng hơn `Shutdown` = 3 hit, cả ba ở `apps/api/src/crypto/local-kek.provider.ts` (`OnApplicationShutdown` import dòng 3, `implements … OnApplicationShutdown` dòng 31, `onApplicationShutdown()` dòng 40) — đây là NestJS lifecycle hook trên `LocalKekProvider` (zero hoá KEK cache lúc shutdown), KHÔNG liên quan `main.ts`/`enableShutdownHooks()`/SIGTERM. Kết luận gốc ("main.ts không có shutdown hook nào") vẫn ĐÚNG, chỉ bằng chứng grep bị ghi sai |
| Precedent "mirror main.ts trong test" đã tồn tại trong repo | `openapi-contract.e2e-spec.ts:74` tự comment `// MIRROR main.ts: setGlobalPrefix TRƯỚC setupSwagger` — tự dựng lại thứ tự bằng tay, KHÔNG import `main.ts` (an toàn vì `main.ts` có side-effect top-level `void bootstrap()` — memory `script-with-toplevel-main-runs-on-import`) | `apps/api/test/foundation/openapi-contract.e2e-spec.ts:69-77` |
| `RealtimeEmitterService.emitNotification` — đường NOTI sống DUY NHẤT qua namespace `/ws` | `server.to(userRoomName(...)).emit(WS_EVENTS.NOTIFICATION_NEW, payload)` — set 1 lần bởi `RealtimeGateway.afterInit` qua `emitter.setServer(server)`. Đổi bootstrap sai có thể làm `server` không bao giờ được set hoặc set nhầm instance | `realtime-emitter.service.ts:28-30,33-37` · `realtime.gateway.ts:80` |
| Mint JWT thật cho int-spec KHÔNG cần đi qua HTTP login | `TokenService.signAccessToken({sub, companyId, email})` — không truyền `aud` ⇒ token hợp lệ ở audience mặc định `'tenant'`, `verifyAccessToken` (gọi trong `extractToken`/gateway) chấp nhận | `apps/api/src/auth/token.service.ts:79-85,100` |
| Route census KHÔNG bị chạm | WO này không thêm/sửa `@Controller`/route nào (chỉ `main.ts` + `realtime/**` bootstrap-level) — tự verify bằng `harness/check.sh` (route-guard-coverage) sau khi code, không cần `ROUTE_CENSUS_WRITE=1` | suy luận từ phạm vi thi công §2 |

---

## 1. Quyết định thiết kế — chốt ở đây

### 1.1 Tách một hàm dùng chung `setupWebSocketAdapter(app, env)` — KHÔNG lặp lại kiểu "mirror main.ts"

`main.ts` không thể import trực tiếp được test dùng (`void bootstrap()` chạy ngay khi import — trap đã biết). Codebase có tiền lệ giải quyết việc này bằng cách **tự tay mirror thứ tự gọi trong test** (`openapi-contract.e2e-spec.ts:74`) thay vì tái cấu trúc `main.ts`. WO này **không** theo tiền lệ đó, vì:

- Gốc rễ của chính WO này là *"code định nghĩa đúng nhưng không ai gọi, không test nào phát hiện được vì không test nào chạm production path thật"*. Nếu bằng chứng RED của WO lại là một bản mirror viết tay trong test, WO tự tái tạo đúng lớp rủi ro nó đang vá.
- Extract phần **wiring adapter** (không phải toàn bộ bootstrap — không đụng CORS HTTP/pipes/filters/swagger) thành `setupWebSocketAdapter(app: INestApplicationContext, env: Env): Promise<ValkeyIoAdapter>` ở `apps/api/src/realtime/setup-websocket-adapter.ts`, mirror đúng convention `setupSwagger(app, nodeEnv)` đã có (`config/swagger.ts:77`). `main.ts` và int-spec **cùng import và gọi hàm này** — test chạy đúng code production, không phải bản chép tay.
- Phần còn lại (đúng *dòng nào trước dòng nào* trong `main.ts`) được khoá riêng bằng một test đọc **source text thật** của `main.ts` (§4, ca 6) — không cần refactor toàn bộ `main.ts` thành hàm export được (đổi phạm vi lớn hơn `paths` của WO cho phép: chỉ `apps/api/src/main.ts` + `apps/api/src/realtime/**` + `apps/api/test/integration/**`).

```ts
// apps/api/src/realtime/setup-websocket-adapter.ts
export async function setupWebSocketAdapter(
  app: INestApplicationContext,
  env: ReturnType<typeof loadEnv>,
): Promise<ValkeyIoAdapter> {
  const adapter = new ValkeyIoAdapter(app);
  if (env.VALKEY_URL) {
    const connected = await adapter.connectToValkey(env.VALKEY_URL);
    if (!connected) logger.error("Valkey adapter KHÔNG kết nối được — multi-instance broadcast TẮT (in-memory)");
  } else {
    logger.error("VALKEY_URL chưa cấu hình — multi-instance broadcast TẮT (in-memory)");
  }
  app.useWebSocketAdapter(adapter); // PHẢI gọi — kể cả khi Valkey fail (fail-LOUD, không fail-closed, xem §1.3)
  return adapter;
}
```

`main.ts` gọi hàm này **ngay sau khối `enableCors` HTTP** (gom "cấu hình cross-origin" lại một chỗ đọc cho dễ), và **trước** `app.listen(env.API_PORT)`. Vị trí chính xác giữa 2 mốc đó không ảnh hưởng hành vi (đã chứng minh ở §0 bằng nguồn framework) — chọn ngay sau CORS thuần vì lý do đọc-hiểu, không phải ràng buộc kỹ thuật.

### 1.2 Fail-**LOUD**, không fail-closed, khi Valkey không kết nối được

Hai lựa chọn:

| Lựa chọn | Hệ quả |
| --- | --- |
| **Fail-closed** (không boot nếu Valkey fail) | An toàn tuyệt đối cho tính đúng của join/leave đa-instance, nhưng: (a) PROD hiện **1 instance duy nhất** (NSSM) — Valkey down không hề ảnh hưởng tính đúng khi chỉ có 1 tiến trình; (b) CORS (fix chính của WO) **độc lập hoàn toàn** với việc Valkey có kết nối được hay không — `createIOServer()` luôn set `cors` từ `env.CORS_ORIGIN` bất kể `adapterConstructor` null hay không (`valkey-io.adapter.ts:62-68`); (c) chặn boot vì một dependency phụ trợ (pub/sub broadcast) sẽ làm **100% API** (auth, HR, chấm công…) không lên được — thiệt hại vượt xa lỗ đang vá |
| **Fail-loud (chọn)** | Boot bình thường, log **ERROR** (không phải WARN) + trạng thái quan sát được qua `isMultiInstanceReady(): boolean` (getter mới, mirror `ValkeyService.isEnabled()` — `permission/valkey.service.ts:46-48`). CORS vẫn đúng. Nhược điểm: nếu không ai đọc log/gọi getter, tình trạng "chỉ đúng trên 1 instance" có thể kéo dài âm thầm khi PROD scale ra nhiều instance sau này — ghi nợ ở §5 (wire vào `/health` hoặc metrics là việc của WO khác, ngoài phạm vi — không thêm route HTTP ở đây) |

**Chốt: fail-loud.** PROD 1-instance hôm nay khiến fail-closed bất cân xứng; CORS (root cause chính được yêu cầu vá) không phụ thuộc Valkey nên không có lý do kéo cả API xuống theo.

### 1.3 Đổi `logger.warn` → `logger.error` khi `connectToValkey` thất bại + thêm `isMultiInstanceReady()`

`valkey-io.adapter.ts:51` hiện `this.logger.warn(...)`. Đổi thành `.error(...)` (cả hai nhánh: connect throw VÀ `VALKEY_URL` vắng) để LOUD thật sự phân biệt được với các WARN bình thường khác trong log. Thêm:

```ts
isMultiInstanceReady(): boolean {
  return this.adapterConstructor !== null;
}
```

— quan sát được bằng test (không cần đọc log), mirror đúng convention `ValkeyService.isEnabled()` đã có trong codebase.

### 1.4 CORS phải chứng minh bằng client thật kết nối cross-origin thật — không dùng `supertest` in-memory

`supertest` gọi `app.getHttpServer()` không cần `.listen()` thật cho HTTP thường, nhưng WS handshake cross-origin cần một cổng TCP thật để `socket.io-client` (Node, dùng CHỈ để kiểm tra logic server — không chứng minh được hành vi trình duyệt, xem §1.6) tạo kết nối network thật kèm header `Origin` tuỳ chỉnh. Int-spec phải `await app.listen(0)` (cổng ngẫu nhiên) rồi dùng `io(\`http://localhost:${port}/ws\`, {extraHeaders: {origin: "..."}})`.

Phép thử origin CHO PHÉP phải là **cross-origin thật** (khác host:port của chính server test) — nếu không, ngay cả khi adapter KHÔNG được wire, mặc định của `socket.io` v4 vẫn chấp nhận same-origin, và ca test sẽ "xanh giả" dù không chứng minh được gì về CORS.

### 1.5 Đánh đổi `transports` phía client — ghi lại, KHÔNG chốt thay FE

Backlog `src` đã chỉ ra: `socket.io-client` mặc định thử `polling` trước, và request polling cross-origin bị chặn nếu thiếu CORS — đúng cơ chế lỗi hiện tại. Nếu FE-1 sau này chốt `transports: ["websocket"]` (bỏ polling), request đầu tiên là upgrade GET thay vì polling GET/POST — engine.io **vẫn** áp origin-check cho cả hai loại request (không chỉ polling), nên né polling KHÔNG né được yêu cầu cấu hình CORS đúng, chỉ né được kiểu lỗi "xhr poll error" cụ thể — đổi lại mất fallback long-polling ở mạng chặn WS thô (proxy doanh nghiệp, một số 4G). **RT-0 không chốt thay** — int-spec (§4) test CẢ HAI transport (`["polling","websocket"]` mặc định VÀ `["websocket"]`) để đảm bảo server đúng bất kể FE chọn gì; FE-1 tự quyết theo nhu cầu thực tế của mạng người dùng.

### 1.6 Giới hạn phải nói rõ trong DoD: client Node không thực thi CORS

Mọi ca `socket.io-client` (Node) trong §4 chỉ chứng minh **server-side origin allow-list logic đúng** (server có từ chối origin lạ dựa trên header `Origin` hay không) — **không** chứng minh trình duyệt thật sẽ tôn trọng nó, vì Node không có Same-Origin Policy để vi phạm. done_when #4 của WO đòi hỏi bằng chứng bổ sung ngoài test tự động: xem §6.

---

## 2. Thi công — bảng file

| File | Thay đổi |
| --- | --- |
| `apps/api/src/realtime/valkey-io.adapter.ts` | Sửa: `logger.warn` → `logger.error` ở nhánh connect-fail (dòng ~51) VÀ nhánh thiếu `VALKEY_URL` (mới, hiện chưa log gì ở nhánh này — `connectToValkey` chỉ được gọi nếu có URL, nên "thiếu URL" phải log ở caller, xem file kế); thêm `isMultiInstanceReady(): boolean` |
| `apps/api/src/realtime/setup-websocket-adapter.ts` **(MỚI)** | Hàm dùng chung §1.1 — construct adapter, gọi `connectToValkey` có điều kiện, log ERROR khi thiếu URL hoặc fail, LUÔN gọi `app.useWebSocketAdapter(adapter)`, trả về instance |
| `apps/api/src/main.ts` | Import `setupWebSocketAdapter`; gọi `await setupWebSocketAdapter(app, env)` ngay sau khối `app.enableCors(...)`, TRƯỚC `app.listen(env.API_PORT)` |
| `apps/api/src/realtime/valkey-io.adapter.spec.ts` **(MỚI)** | Unit test class adapter: connect ok → `isMultiInstanceReady()===true`, không log error; connect fail (mock `ioredis`) → log ERROR + `isMultiInstanceReady()===false`; `createIOServer` luôn set `cors` từ `CORS_ORIGIN` bất kể adapter Valkey có hay không |
| `apps/api/src/realtime/setup-websocket-adapter.spec.ts` **(MỚI)** | Unit test hàm wiring: luôn gọi `app.useWebSocketAdapter` (kể cả khi Valkey fail); thiếu `VALKEY_URL` → log ERROR + không gọi `connectToValkey` |
| `apps/api/src/realtime/main-bootstrap-order.spec.ts` **(MỚI)** | Đọc **source text thật** của `../main.ts` bằng `readFileSync`, assert vị trí ký tự của lời gọi `setupWebSocketAdapter(` đứng TRƯỚC `app.listen(`; assert `app.enableCors(` vẫn còn (regression guard, không xoá nhầm CORS HTTP). Đặt trong `realtime/**` (không phải `main.spec.ts` ở `src/` gốc) để nằm trong `paths` của WO (`apps/api/src/main.ts` là path LITERAL, không phải glob, nên file test mới không được đặt cạnh nó) |
| `apps/api/test/integration/chat-rt0-ws-adapter.int-spec.ts` **(MỚI)** | LANE_DB-gated (`hasDb && LANE_DB`) — boot `AppModule` thật qua `Test.createTestingModule` + `setupWebSocketAdapter` + `app.listen(0)`; `socket.io-client` thật cross-origin allow/deny; regression `emitNotification` vẫn tới đúng room sau khi adapter gắn |

**Không sửa:** `realtime.gateway.ts`, `realtime-emitter.service.ts`, `rooms.ts`, 3 spec hiện có (`realtime.gateway.spec.ts`, `realtime.gateway.io.spec.ts`, `realtime-emitter.service.spec.ts`) — giữ nguyên làm lưới regression (§4 ca 11).

---

## 3. KHÔNG làm trong WO này

- ❌ Không thêm `@SubscribeMessage` nào — giữ nguyên WS một chiều (đó là phạm vi `S7-CHAT-RT-1`, CHAT-DEC-005).
- ❌ Không đổi payload/DTO của `notification:new`/`notification:read` hay bất kỳ contract WS nào.
- ❌ Không thêm route HTTP nào — route census không cần regen.
- ❌ Không wire trạng thái `isMultiInstanceReady()` vào `/health` hay metrics — chỉ quan sát được qua log ERROR + getter (test-only) ở WO này; wiring ra HTTP/dashboard là việc khác (ghi nợ §5).
- ❌ Không gọi `disconnectValkey()` ở shutdown hook — `main.ts` chưa có `app.enableShutdownHooks()`/SIGTERM handler nào (đo ở §0); dựng graceful-shutdown là hạ tầng riêng, ngoài phạm vi `done_when` của WO này (ghi nợ §5).
- ❌ Không chốt `transports` phía client thay FE-1 (§1.5) — chỉ test cả hai để đảm bảo server đúng với mọi lựa chọn.
- ❌ Không cô lập Valkey theo lane (không có "LANE_VALKEY") — dùng chung 1 instance `redis://localhost:6379`, chấp nhận vì mô hình vận hành hiện tại là tuần tự 1 WO/phiên (CLAUDE.md §9).
- ❌ Không refactor toàn bộ `main.ts` thành hàm `createApp()` export được — phạm vi tách hàm chỉ giới hạn ở phần wiring WS adapter (§1.1), vì `paths` của WO không cho phép file mới ngoài `apps/api/src/main.ts` (literal) và `apps/api/src/realtime/**`.

---

## 4. Test RED-trước

| # | Ca | Kỳ vọng | Loại |
| --- | --- | --- | --- |
| 1 | `setupWebSocketAdapter(app, env)` | gọi đúng 1 lần `app.useWebSocketAdapter(adapter)` | unit, no DB |
| 2 | `VALKEY_URL` hợp lệ + Valkey sống | `connectToValkey` true, KHÔNG log ERROR, `isMultiInstanceReady()===true` | unit, mock ioredis |
| 3 | `VALKEY_URL` **thiếu** | log **ERROR** (không phải WARN) + `isMultiInstanceReady()===false`, **vẫn** gọi `useWebSocketAdapter` (app vẫn boot) | unit, no DB |
| 4 | `VALKEY_URL` trỏ host không kết nối được | log **ERROR** + `isMultiInstanceReady()===false`, vẫn gọi `useWebSocketAdapter` | unit, mock ioredis reject |
| 5 | `createIOServer()` | luôn set `cors` từ `CORS_ORIGIN` bất kể `adapterConstructor` null hay không | unit, no DB (đã đúng trong code hiện có — pin lại, không phải hồi quy) |
| 6 | Source `main.ts`: vị trí `setupWebSocketAdapter(` | đứng TRƯỚC `app.listen(` (so sánh `indexOf`) | unit, đọc file, no DB |
| 7 | Source `main.ts`: `app.enableCors(` | vẫn tồn tại (regression HTTP CORS) | unit, đọc file, no DB |
| 8 | Int-spec: client Node, Origin **CÓ** trong `CORS_ORIGIN`, cross-origin thật (cổng khác server test), token hợp lệ (`signAccessToken`) | **connect thành công** — CHỈ đúng nếu adapter đã wire (mặc định socket.io v4 từ chối MỌI cross-origin khi không cấu hình cors) | int-spec, LANE_DB |
| 9 | Int-spec: cùng server, Origin **KHÔNG** có trong `CORS_ORIGIN` | bị từ chối **ở handshake** (lỗi CORS/transport — phân biệt được với lỗi `unauthorized` của ca thiếu token) | int-spec, LANE_DB |
| 10 | Int-spec: cả `transports:["polling","websocket"]` (mặc định) và `transports:["websocket"]` | ca 8/9 đúng với CẢ HAI cấu hình transport (§1.5) | int-spec, LANE_DB |
| 11 | Int-spec: sau khi connect (ca 8), gọi `app.get(RealtimeEmitterService).emitNotification(companyId, userId, dto)` | client nhận đúng sự kiện `notification:new` — chứng minh gắn adapter KHÔNG phá đường NOTI hiện có | int-spec, LANE_DB |
| 12 | 3 spec hiện có (`realtime.gateway.spec.ts`, `realtime.gateway.io.spec.ts`, `realtime-emitter.service.spec.ts`) | chạy lại, **giữ nguyên PASS**, không sửa nội dung | regression, no DB |
| 13 | `harness/check.sh --lane-db` sau khi code | route-guard-coverage / openapi-modules không đổi (0 route mới) | regression |

Chạy: `bash scripts/lane-db-setup.sh chatrt0` → `export LANE_DB=mediaos_chatrt0` → `bash harness/check.sh --lane-db`. Nạp env trước khi gọi vitest tay (memory `lane-db-run-needs-explicit-urls`):

```bash
set -a && . ./.env && set +a
unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL PGBOUNCER_URL
export LANE_DB=mediaos_chatrt0
```

Drop lane DB sau khi xong (memory `pgdata-bloat-lane-dbs-and-job-log`).

### 4.1 Bằng chứng RED (bắt buộc — vá tạm, chạy, hoàn nguyên)

| Vá tạm | Ca ĐỎ kỳ vọng |
| --- | --- |
| Đổi `main.ts`: đảo thứ tự — gọi `await app.listen(env.API_PORT)` TRƯỚC `await setupWebSocketAdapter(app, env)` | ca 6 (structural, tức thì) **và** ca 8 (cross-origin connect thật) — chứng minh cả lý-thuyết-framework lẫn hành-vi-thực-tế đều bắt được lỗi đảo thứ tự |
| Xoá dòng `app.useWebSocketAdapter(adapter)` khỏi `setupWebSocketAdapter` | ca 1, ca 8 |
| Đổi `logger.error` lại thành `logger.warn` ở nhánh connect-fail/thiếu-URL | ca 3, ca 4 |
| Xoá `{...options, cors}` trong `createIOServer`, chỉ truyền `options` trần | ca 5, ca 8 (connect cross-origin hợp lệ cũng đỏ) |

---

## 5. Rủi ro & nợ

- **Fail-loud có thể bị lờ đi.** Log ERROR + `isMultiInstanceReady()` chỉ quan sát được nếu có người đọc log hoặc gọi getter — không có route/metrics nào bắt buộc kiểm tra định kỳ. Nợ: wire vào `/health` hoặc dashboard ở WO hạ tầng riêng khi PROD thật sự chuyển sang đa-instance.
- **`disconnectValkey()` vẫn mồ côi.** Không có `enableShutdownHooks()` trong `main.ts` nên method này (đã có sẵn trên adapter) không bao giờ chạy. Rủi ro thấp (process exit tự đóng socket OS-level), nhưng là nợ kỹ thuật rõ ràng nếu sau này có graceful-restart.
- **Smoke trình duyệt thật KHÔNG tự động hoá được** (client Node không thực thi CORS — §1.6) và **`apps/app` hôm nay chưa có code WS nào** để "mở app rồi nhìn" theo đúng nghĩa đen của done_when #4. Đây là bước NGƯỜI, phải có bằng chứng đính kèm PR (§6) — rủi ro bị bỏ qua nếu người merge coi FULL gate tự động là đủ.
- **Valkey dùng chung giữa các lane** (không cô lập như Postgres `LANE_DB`) — nếu chạy song song với WO khác cũng test Valkey có thể đụng kênh pub/sub. Giảm nhẹ nhờ mô hình 1-WO/phiên tuần tự (CLAUDE.md §9); không xử lý thêm ở WO này.
- **Đây là hạ tầng dùng chung cho MỌI namespace WS tương lai**, không riêng CHAT — `RealtimeGateway` hiện phục vụ NOTI, và `S7-CHAT-RT-1` sắp tới sẽ join phòng chat trên CÙNG namespace `/ws`. Một lỗi wiring ở đây ảnh hưởng cả hai, không chỉ CHAT — đây là lý do chính đáng cho zone đỏ/FULL gate dù WO không chạm permission/RLS/migration cổ điển: sai CORS/adapter có thể (a) mở handshake WS cho origin tuỳ ý (bỏ qua ranh giới SOP quanh socket mang JWT), và (b) nếu đa-instance mà không broadcast đúng, tin/thông báo có thể "rò" tới người vừa bị gỡ khỏi phòng ở instance khác — đúng loại rủi ro `security-reviewer` cần nhìn.

---

## 6. Definition of Done (map 1-1 `done_when`)

| # | `done_when` (backlog) | Đáp ứng bằng |
| --- | --- | --- |
| 1 | `main.ts` gọi `useWebSocketAdapter` + `connectToValkey` TRƯỚC `listen`; có test/assert chứng minh thứ tự | `setupWebSocketAdapter` (§1.1) gọi cả hai; ca test 6 (structural, đọc source) + ca 8 (hành vi thật) + bằng chứng RED §4.1 dòng 1 |
| 2 | CORS Socket.IO đọc đúng `CORS_ORIGIN` (nhiều origin, trim); test chứng minh origin NGOÀI danh sách bị từ chối ở handshake | ca 8 (allow) + ca 9 (deny) + ca 10 (cả 2 transport) trên server thật, cross-origin thật |
| 3 | Fail-soft im lặng → LOUD (log ERROR + đánh dấu trạng thái) | `logger.error` (thay `warn`) + `isMultiInstanceReady()`; ca 3, 4 |
| 4 | Smoke bằng TRÌNH DUYỆT THẬT (không phải client Node) | **Thủ công, bắt buộc trước merge:** dựng 1 file HTML tĩnh tạm (không commit) dùng `socket.io-client` qua CDN, ký JWT test qua script/`app.get(TokenService)` tạm hoặc login thật, phục vụ qua một origin CÓ trong `CORS_ORIGIN` (vd `http://localhost:5273` — dùng tạm `apps/app`'s vite dev server hoặc `npx serve`) → mở tab, console PHẢI thấy `connect` không lỗi CORS; lặp lại qua origin KHÔNG trong danh sách (vd `npx http-server` cổng khác) → console PHẢI thấy lỗi CORS rõ ràng. Đính kèm ảnh chụp/log console vào PR làm bằng chứng — đây là gate NGƯỜI, không phải CI |
| 5 | FULL gate PASS | `security-reviewer` + `silent-failure-hunter` theo policy zone đỏ (lý do nêu ở §5) — chạy sau khi 13 ca §4 xanh trên `LANE_DB` |

Bổ sung (không phải done_when gốc nhưng bắt buộc theo CLAUDE.md §8/§9):
- [ ] 3 spec hiện có giữ nguyên PASS (ca 12, regression NOTI/gateway).
- [ ] Route census không đổi — tự verify, không cần `ROUTE_CENSUS_WRITE=1`.
- [ ] Lane DB `mediaos_chatrt0` drop sau khi xong.
- [ ] `harness/backlog.mjs` — cập nhật `status` của `S7-CHAT-RT-0` khi xong (không sửa tay `docs/STATUS.md`, tự sinh).
