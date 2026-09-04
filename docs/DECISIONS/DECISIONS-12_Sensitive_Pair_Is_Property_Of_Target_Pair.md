# DECISIONS-12 — `is_sensitive` là thuộc tính của CẶP ĐÍCH, không phải của HÀNG GRANT KHỚP

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ CHỐT 2026-09-04** — thi hành trong WO `S14-SEC-DASHGATE-WILDCARD-1` |
| **Ngày** | 2026-09-04 |
| **Bối cảnh** | Đo 03/09 bằng test chạy thật: actor cầm DUY NHẤT grant `('*','*')` **qua được** `gateWidgetOrThrow(…,'PAYROLL_COST')` — cặp đích `view-line:payroll-period` là **sensitive** |
| **Vùng** | 🔴 ĐỎ — crown-jewel: `can()` hot-path của TOÀN hệ |
| **Phạm vi** | `permission.decide.ts` (một biểu thức) · `permission.types.ts` (một trường) · `permission.service.ts` (ảnh chụp catalog + 4 điểm bơm) · `permission-catalog-snapshot.ts` (mới). **KHÔNG** migration, **KHÔNG** đổi catalog quyền, **KHÔNG** đụng seed/grant |

---

## 1. Lỗ — cơ chế chính xác

`permission.decide.ts:103` (trước bản vá):

```ts
const effectivelySensitive = isSensitive || companyAllows.some((g) => g.isSensitive);
```

`companyAllows` là **HÀNG GRANT KHỚP** (wildcard-aware). Actor chỉ cầm `('*','*')` ⇒ hàng khớp là hàng
`*:*`, mà `permissions.is_sensitive` của **chính hàng đó** = `false` ⇒ `effectivelySensitive = false` ⇒
rơi xuống nhánh «priority 4: non-sensitive ALLOW (wildcards valid here)» ⇒ **ALLOW**, dù **cặp đích** là
sensitive. Cùng cơ chế ở `decideStrongestScope:202-203` (đường sàn scope).

**Cờ được đọc của HÀNG GRANT, không phải của CẶP ĐÍCH. Đó là toàn bộ lỗ.**

Cổng sensitive vốn được thiết kế đúng — nó đòi «grant EXACT non-wildcard» — nhưng nó **chỉ bật** khi
biết cặp đích là sensitive, và nguồn tri thức duy nhất nó có (hàng grant khớp) chính là hàng wildcard
mà nó định chặn. Cổng tự khoá mình bằng chìa của kẻ đi qua.

**Không phải lỗ:** actor có grant EXACT cho cặp sensitive ⇒ hàng đó mang `is_sensitive=true` ⇒ gate đúng.
Đây là lý do lỗ không nổ ở đường DỮ LIỆU (§4).

---

## 2. Luật đúng ĐÃ TỒN TẠI ở hai nơi khác — quyết định này là HỘI TỤ, không phát minh

| Nơi | Cách làm | Trạng thái trước 04/09 |
| --- | --- | --- |
| `permission.service.ts` `userGrantsPermissionIds` | `if (p.isSensitive)` với `p` = **catalog entry của cặp đích** ⇒ ép `allows.some(g => g.action!=='*' && g.resourceType!=='*')` | ĐÚNG |
| `payroll-approver.reader.ts:70-74` | SQL: wildcard tính cho vế DENY, **không** tính cho vế ALLOW của cặp đích | ĐÚNG |
| `decideCan` / `decideStrongestScope` | đọc cờ của **hàng grant khớp** | **SAI** ← WO này vá |

⇒ **Ba bản cài đặt này là MỘT HỌ và phải giữ đồng bộ.** Sửa luật sensitive ở một bản mà không đối chiếu
hai bản kia là dựng lại chính lỗ này ở chỗ khác. Ai chạm một trong ba, đọc lại cả ba.

---

## 3. Hai hướng đã cân nhắc

### (A) Mỗi call site tự truyền `isSensitive` của cặp đích — **LOẠI**

Đo 03/09 bề mặt gọi thiếu cờ:

| Đường | Tổng | Thiếu `isSensitive` |
| --- | --- | --- |
| `permission.can({...})` | 36 | **25** |
| `dataScope.resolveOrNull / resolveAndAssert / resolveManyOrNull` | 120 | **87** |

**112 điểm gọi.** Phần lớn truyền cặp **ĐỘNG** (`assertCan(action, resourceType)`, `pair.action`,
`FOUNDATION_FILE_PERMISSION[input.action]`) ⇒ không sửa tĩnh được: mỗi site sẽ phải tự tra catalog.
(A) = (B) nhân 112, cộng 112 cơ hội quên. Và mỗi WO mới thêm một cơ hội quên nữa — bản vá không tự giữ.

### (B) Engine tra cờ theo CẶP ĐÍCH — **CHỌN**

Một ảnh chụp catalog trong `PermissionService`; `decideCan`/`decideStrongestScope` nhận thêm trường
`pairIsSensitive` và OR vào cổng wildcard. Call site **không đổi một dòng nào**. Cặp mới thêm vào catalog
tự được bảo vệ.

Giá phải trả — và biện pháp — ở §5.

---

## 4. 🔴 CHƯA NỔ ngoài thực địa ≠ đã an toàn

Đường DỮ LIỆU vẫn kín tới hôm nay nhờ **ba lớp độc lập**, không lớp nào là bản vá:

1. mig 0565 §6.7 census fail-closed — **0 role SEED giữ wildcard**;
2. hai role tuỳ biến PROD từng giữ wildcard đã thu hồi ở `S14-PROD-PAYROLLGRANT-1`;
3. tầng-2 service nguồn (`PayrollAccessService` / `RecruitAccessService`) truyền cờ **tường minh**.

Đo 03/09 trên DB dev: catalog **390** hàng / **139** sensitive / đúng **1** hàng wildcard (`*:*`,
`is_sensitive=false`) / **0 role giữ wildcard** — kể cả `SA` (SA giữ **372 cặp EXACT**).

**Một role tuỳ biến mới cầm `*:*` là lỗ sống lại.** Quyết định này bịt ở tầng engine để lớp 1–3 trở lại
đúng vai defense-in-depth thay vì là thứ duy nhất đang đỡ.

---

## 5. Thiết kế đã chốt

### 5.1 Trường RIÊNG `pairIsSensitive`, KHÔNG OR vào `isSensitive`

`isSensitive` điều khiển **ba** thứ khác nhau trong `decideCan`:

| Dùng ở | Dòng (trước vá) | Hệ quả nếu bị lật ngầm |
| --- | --- | --- |
| cổng wildcard/exact | `:103-110`, `:202-208` | ← **chỗ DUY NHẤT muốn đổi** |
| `auditRequired` ở object-tier ALLOW | `:82` | `hr-read.service.ts:360,393` · `employees.service.ts:223` dùng `reveal = allow && auditRequired` ⇒ lật `false→true` biến **MASK thành REVEAL** |
| `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)` | `:95-98` | deny **cả actor có grant EXACT** |

⇒ Cờ mới đặt ở **một dòng duy nhất**, **SAU** cả hai vùng nguy hiểm:

```ts
const effectivelySensitive =
  isSensitive || companyAllows.some((g) => g.isSensitive) || (pairIsSensitive ?? false);
```

Vị trí giải quyết hai rủi ro trên **về mặt cấu trúc**, không bằng kỷ luật: object-tier trả về ở `:82` và
`needsObjectGrant` quyết ở `:95-98` đều **trước** dòng này ⇒ cờ mới không với tới được chúng.

### 5.2 Trạng thái mới — và `auditRequired` phải SUY RA, không hard-code

> 🔴 **Sửa 2026-09-04 sau security-review (verdict BLOCK).** Bản đầu mục này khẳng định: «mọi lần vào
> nhánh sensitive NHỜ `pairIsSensitive` đều có `explicitAllows === []` ⇒ chỉ đẻ ra `deny-sensitive`,
> không `auditRequired` nào đổi». **Khẳng định đó SAI.** Nó dựa trên giả định cờ hàng-grant LUÔN bằng
> cờ catalog (qua `innerJoin(permissions)`) — đúng ở trạng thái ổn định, sai ở hai trạng thái THẬT:
>
> 1. **Catalog suy biến.** Ảnh chụp nạp hỏng khi chưa có ảnh ⇒ `pairIsSensitive = true` cho MỌI cặp,
>    trong khi `CachedPermissionRepository` vẫn phục vụ grant từ Valkey (không chạm DB) với cờ THẬT.
>    Actor có grant EXACT trên cặp **non-sensitive** ⇒ vào nhánh sensitive, `explicitAllows` **KHÔNG
>    rỗng** ⇒ chạm return ALLOW cuối nhánh.
> 2. **Cache grant cũ.** `permissions.is_sensitive` vừa lật false→true; hàng grant trong cache còn mang
>    cờ CŨ tối đa `CACHE_TTL_SEC = 300`s. Cùng hình dạng lệch.
>
> Ở cả hai, hard-code `auditRequired: true` tại return đó **lật `reveal = allow && auditRequired` từ
> false sang true** ⇒ biến MASK thành REVEAL. Không phải rò dữ liệu hôm nay (mọi consumer `reveal` hiện
> đều truyền `isSensitive: true`), nhưng nó biến một bảo đảm CẤU TRÚC thành kỷ luật call-site — đúng
> thứ §5.1 tuyên bố đã thay thế — và làm consumer TIẾP THEO thành lỗ thật.

**Chốt:** ở return ALLOW cuối nhánh sensitive, `auditRequired` được **suy ra**:

```ts
auditRequired: isSensitive || companyAllows.some((g) => g.isSensitive)
```

- Mọi trạng thái tới được return này **trước** bản vá đều có một trong hai vế `true` ⇒ biểu thức cho
  `true`, y hệt hằng cũ ⇒ **không đổi hành vi cũ một bit nào**.
- Trạng thái **mới** cho `false` — đúng bằng giá trị mà CÙNG đầu vào ấy nhận ở priority 4 trước bản vá
  ⇒ `reveal` được bảo toàn.

⇒ **Bất biến ĐÚNG, phát biểu lại:** `pairIsSensitive` chỉ có thể đưa `allow` từ true→false, và **không
bao giờ** đưa `reveal` từ false→true. Ghim ở `permission.decide.pair-sensitive.spec.ts` #14/#14a (ma
trận có hai hàng LỆCH) · #15 · #15c — đột biến hard-code lại `true` làm 4 ca ĐỎ.

| Trạng thái cũ | Mới | Ý nghĩa |
| --- | --- | --- |
| `allow / auditRequired:false` (actor **chỉ có wildcard**) | `deny-sensitive` | ← **chính là lỗ đang vá** |
| `deny-default / auditRequired:false` (actor **không có grant nào khớp**) | `deny-sensitive` | vẫn DENY, nhưng **`reason` đổi** |

**`reason` là chuỗi ĐI RA NGOÀI**, không chỉ nằm trong log: `files.service.ts` đưa nó vào **cả message
403 lẫn cột `file_access_logs.denied_reason`** (dữ liệu LƯU LẠI); `permission.guard.ts` và
`profile-change-request.service.ts` nhét vào message. Đổi `deny-default → deny-sensitive` trên cặp
sensitive là **chủ đích** và phải cập nhật kỳ vọng test, KHÔNG kết luận bản vá sai.

### 5.3 Ảnh chụp catalog — vòng đời

| Q/Đ | Nội dung |
| --- | --- |
| **D1 — không preload lúc boot** | `OnModuleInit` đọc DB biến DB thành phụ thuộc CỨNG lúc khởi động; API PROD hiện **boot được khi chưa có DB**. Nạp lười ở lần kiểm quyền đầu. |
| **D2 — hỏng khi nạp** | Có ảnh chụp cũ + refresh lỗi ⇒ GIỮ ảnh cũ + `logger.error`, KHÔNG ném. Chưa có ảnh chụp + nạp lỗi ⇒ `pairIsSensitive = true` + `logger.error`, KHÔNG ném, **KHÔNG đóng dấu TTL** (blip DB không khoá 300s). Nhờ §5.1, `true` chỉ siết cổng wildcard ⇒ degradation có biên. **Cấm ném:** `can()` bọc try/catch fail-closed ⇒ một lỗi catalog sẽ deny TOÀN BỘ kiểm quyền = sự cố lớn hơn lỗ đang vá. |
| **D3 — ảnh chụp ĐÃ NẠP _và KHÔNG RỖNG_ mà cặp VẮNG ⇒ `false`** | Cặp không có trong catalog không thể là cặp sensitive của catalog. ⚠️ **Thu hẹp bởi D9 (S14-SEC-CATALOGSNAP-HARDEN-1):** bản đầu không có vế «KHÔNG RỖNG» và biện minh bằng lý do TIỆN TEST («chọn `true` sẽ làm hàng loạt spec đỏ»). Lý do đó **sai đối tượng** — nó nói về `[]` (ảnh RỖNG), không phải về cặp VẮNG. Xem D9. |
| **D4 — cặp truy vấn tự chứa `*` ⇒ `true`** | Chặn `*` thành đường lách chính bản vá. |
| **D5 — TTL** | `PERMISSION_CATALOG_TTL_MS = 300_000`, refresh **await** khi hết hạn, kèm timeout cho query (DB treo không kéo `can()` treo theo). |
| **D6 — single-flight** | `dashboard-widget-registry.service.ts` gọi `Promise.all(rows.map(… can()))` ⇒ ảnh chụp lạnh + N widget = N query song song. Giữ promise đang bay, trả lại cho mọi caller đồng thời. **Promise chia sẻ KHÔNG BAO GIỜ reject** — bọc try/catch BÊN TRONG, trả sentinel, xoá slot trong `finally`; để nó reject là bắn unhandled rejection trên đường **mọi** `can()` đi qua. |
| **D7 — seam cho test là method PUBLIC trên `PermissionService`** | Ảnh chụp là state **PER-INSTANCE** (module-level làm mọi instance trong cùng file test dùng chung ảnh chụp bất kể repo nào nạp trước). `resetCatalogSnapshotForTest()` gọi qua `app.get(PermissionService)`. |
| **D8 — không Valkey, KHÔNG móc `permission.changed`** | Ảnh chụp trong tiến trình, mỗi instance tự nạp ⇒ 0 khoá chia sẻ để lệch. `permission.changed` là sự kiện của **GRANT**, không phải catalog — nối vào đó là nối nhầm dây. |
| **D9 — `rows.length === 0` là SUY BIẾN, không phải ảnh hợp lệ** _(S14-SEC-CATALOGSNAP-HARDEN-1)_ | Xem §5.4. |

### 5.4 D9 — catalog RỖNG là trạng thái suy biến

**Quyết định:** `load()` trả về `0` hàng ⇒ **KHÔNG** ghi ảnh, **KHÔNG** đóng dấu `loadedAtMs`, **CÓ** gọi
`onError`, trả ảnh **CŨ** nếu có / `null` nếu chưa từng nạp (⇒ mọi cặp = sensitive = **SIẾT**).

**Vì sao.** `permissions` là catalog **GLOBAL** do migration seed (không RLS, không thể trả PARTIAL —
`permission.repository.ts:266-278`, `db/schema/permissions.ts:39-48`). «0 hàng» vì vậy không phải một phát
biểu **nghiệp vụ** («hệ này không có cặp nhạy cảm nào») mà là một phát biểu **hạ tầng** («DB chưa seed /
vừa bị xoá»). Coi nó hợp lệ là để một sự cố hạ tầng **tự tuyên bố** rằng không có gì cần bảo vệ — và
đóng dấu tuyên bố đó suốt TTL 300s, **không một dòng log**.

Bản trước bất đối xứng theo đúng chiều xấu: cùng một sự cố mà biểu hiện bằng **THROW** thì siết + có vết
(D2); biểu hiện bằng **0 hàng** thì nới + im lặng + **được cache**. Và vì `dashboard-widget-gate.ts:58-63`
cố ý không truyền `isSensitive`, `pairIsSensitive` là tín hiệu sensitive **duy nhất** của đường đó ⇒ lỗ
`*:*` mở cặp sensitive dựng lại nguyên vẹn trong 300s. D9 xoá bất đối xứng ấy.

**Vị ngữ là `rows.length`, TUYỆT ĐỐI không `next.size`.** `next.size === 0` trông như dọn dẹp vô hại
(thậm chí «chặt hơn») nhưng nó biến **mọi** catalog không chứa cặp sensitive nào thành trạng thái suy
biến — gồm cả các stub repo hợp lệ trong test. Có ca ghim ở `permission-catalog-snapshot.spec.ts`.
**Hệ quả được CHỌN, không phải bỏ sót:** catalog **có** hàng mà **0** hàng `is_sensitive` (một migration
hỏng xoá sạch cờ) là fail-OPEN mà D9 **không** bắt — vì không phân biệt được với một hệ hợp lệ không có
cặp nhạy cảm nào.

**Sàn thử-lại `PERMISSION_CATALOG_EMPTY_RETRY_MS = 5_000` — chỉ cho nhánh rỗng.** Nhánh `catch` (D2) cố ý
thử lại **mỗi lượt** vì DB đang **chết**: mỗi lượt tự có giá (trần `timeoutMs`) và trạng thái **tự hết**
khi DB sống lại. Nhánh rỗng thì ngược: DB **khoẻ**, query nhanh, trạng thái **không tự lành** nếu chưa ai
seed ⇒ không có sàn thì mỗi `can()` = 1 `SELECT` + 1 `logger.error`, **mãi mãi**, trên hot-path mà mọi
kiểm quyền đi qua (single-flight chỉ gộp lượt **song song**). 5s: ≪ TTL 300s nên không tái lập «khoá suy
biến 300s» mà D2 cấm; ≫ thời gian một request. Đường gỡ **THẬT** có hai: sàn **tự hết hạn**, và
`reset()` (D7) — `reset()` phải gỡ **cả** sàn, nếu không seam test mất tác dụng đúng lúc int-spec seed
cặp mới rồi gọi `resetCatalogSnapshotForTest()`.

Sàn **không** gỡ ở nhánh `catch`, có chủ ý: sàn được kiểm ở **đầu** `refresh()` nên `catch` không thể
chạy trong cửa sổ sàn, và một sàn đã quá hạn là trơ. Cùng lập luận đó cho thấy dòng gỡ sàn ở nhánh nạp
**LÀNH** là **phòng thủ, không phải một đường gỡ**: sàn nào mà một lượt nạp lành với tới được thì đã hết
hạn từ trước. (Đo bằng đột biến: xoá dòng ấy — suite vẫn xanh. Giữ vì vô hại; **đừng** kể nó như một cơ
chế nhả.)

**Thứ tự `epoch` trước kiểm rỗng là BẤT BIẾN, có ca ghim.** Một lượt nạp đã lạc hậu mà đặt được
`retryNotBeforeMs` sẽ khoá **thế hệ ảnh chụp MỚI** bằng sàn của thế hệ CŨ, không đường gỡ — đúng hình
dạng M2, chỉ đổi tên biến. Đột biến «xoá dòng kiểm epoch» từng xanh toàn suite; nay có ca giết nó.
**Đồng hồ lùi** (NTP) kéo dài cửa sổ đúng bằng bước lùi — cùng hạng rủi ro với TTL đã có, không thêm code.

**Quan sát — hai chiều tách bạch.** `onError(error, phase, cause)`: `phase` (`stale-kept` | `no-snapshot`)
= **KẾT QUẢ**, suy **duy nhất** từ `sensitivePairs === null`; `cause` (`load-failed` | `empty-catalog`) =
**NGUYÊN NHÂN**. Nhét cause vào `phase` làm `degradedTo` **nói dối** ở ca «rỗng nhưng CÓ ảnh cũ» (kết quả
là stale-kept, không phải siết). Message log phân nhánh theo `cause` — nhánh rỗng là một lượt nạp **THÀNH
CÔNG**, gọi nó là «load failed» là ghi một dòng sai vào đúng chỗ quan sát duy nhất của nó.

**Forensics lệch — đọc log phải biết.** Trong cửa sổ suy biến, mọi từ chối mang `reason: "deny-sensitive"`
kèm `auditRequired: true` (`permission.decide.ts:136`), và chuỗi này **đi ra ngoài** qua
`file_access_logs.denied_reason` (§5.2). Nhật ký sẽ nói «cặp này nhạy cảm» trong khi sự thật là «không đọc
được catalog». Không đổi `reason` (đó là hợp đồng §5.2) — đối chiếu bằng dòng log `cause=empty-catalog`.

**Hệ quả cho TEST:** một stub `getAllPermissions(): []` giờ **nói dối** (tuyên bố hạ tầng hỏng). Bảy stub
như vậy đã đổi sang hàng canh dùng chung `test/helpers/permission-catalog-fixture.ts`. Cặp mà các spec đó
kiểm vẫn để **VẮNG** ⇒ `false` theo D3 = y hệt hành vi trước D9; **không** hạ sàn, và **0** dòng `expect`
phải đổi.

**Cửa sổ ≤300s:** cặp sensitive seed **khi API đang chạy** có thể lọt tối đa một TTL. Chỉ nổ khi có holder
wildcard (đo: 0). Migration đi kèm deploy ⇒ restart xoá ảnh chụp.

---

## 6. Hệ quả có chủ ý — không phải hồi quy

1. **Kiểu dashboard của actor chỉ-wildcard tụt về `Employee`**: `view-admin/hr/manager:dashboard` đều
   sensitive ⇒ mất; `view-employee:dashboard` non-sensitive ⇒ còn.
2. **Đổi hành vi ở module ngoài DASH.** Cặp sensitive chạm được từ site thiếu cờ:
   `view-line:payroll-period` · `view:candidate` · `view:leave` · `view:audit-log` ·
   `view-own:attendance` · `view-team:attendance` · `view-team:leave-calendar` · `import:employee`.
   Vá theo **BỀ MẶT** là chủ đích của WO, không phải scope creep.
3. **Ca test khẳng định wildcard MỞ được cặp sensitive sẽ đỏ.** Đỏ ở đó là tín hiệu ĐÚNG
   (`tests-can-pin-a-hole-open`). Ca dùng `*:*` để mở cặp **non-sensitive** (vd `manage:offer` ở
   `recruit-be1-scope.int-spec.ts`) **phải vẫn xanh**; nếu đỏ ⇒ bản vá sai, không phải fixture sai.

---

## 7. Ngoài phạm vi — ghi tường minh

- **FE `use-can.ts` có fallback `caps["*:*"]`** và `getCapabilities()` vẫn publish `*:*` (lọc theo cờ
  HÀNG GRANT). Sau bản vá, actor chỉ-wildcard sẽ **thấy** màn sensitive rồi ăn 403 — khoảng lệch nới
  rộng. **Không phải lỗ mới** (đã ghi ở `use-can.ts`, `useCanExact` là lối đúng) và 0 holder wildcard nên
  0 người gặp. **DEFER TƯỜNG MINH** → WO `S14-SEC-CAPWILDCARD-1`.
- Không đổi `SENSITIVE_CAPABILITY_ALLOWLIST` (cờ HIỂN THỊ, không phải cổng).
- Không đổi seed/migration/catalog quyền.
- Không đụng `PayrollAccessService` / `RecruitAccessService` (đã truyền cờ tường minh; `pairIsSensitive`
  trùng lặp vô hại).

---

## 8. Cổng NGƯỜI trước deploy PROD

PROD **không đo được từ phiên agent** (`classifier-blocks-prod-db-from-agent`) ⇒ owner chạy census.

⚠️ Tiêu chí **KHÔNG** phải «có wildcard ⇒ DỪNG»: `super-admin-bootstrap.service.ts` grant TOÀN BỘ catalog
(trừ `reveal-secret:platform-account`) nên SA có thể ôm cả `*:*` mà vẫn đủ cặp EXACT ⇒ không mất gì.

**Tiêu chí đúng:** role giữ wildcard **VÀ THIẾU** grant exact cho cặp sensitive nó đang với tới.

---

**Liên quan:** DECISIONS-06 (động từ quyền chuẩn) · DECISIONS-09 (reauth + object grant) ·
`docs/permission-matrix-spec.md` · `docs/plans/S14-SEC-DASHGATE-WILDCARD-1.md`.
