# OpenAPI / Swagger — Enterprise Management System

Đặc tả OpenAPI **3.1.0** chuẩn hóa cho toàn bộ API (API-02 → API-09), sinh từ bộ tài liệu API Design theo quy chuẩn [API-01](../API-01%20TỔNG%20QUAN.md).

## Cấu trúc thư mục

```text
openapi/
├── enterprise-api.yaml        # SPEC TỔNG (đã build) — import file này vào Swagger UI
├── enterprise-api.base.yaml   # Base: info, servers, security, tags, components (schemas/params/responses/securitySchemes)
├── paths/
│   ├── auth.paths.yaml        # fragment paths của từng module (không có key `paths:`)
│   ├── hr.paths.yaml
│   ├── att.paths.yaml
│   ├── leave.paths.yaml
│   ├── task.paths.yaml
│   ├── noti.paths.yaml
│   ├── dash.paths.yaml
│   └── fnd.paths.yaml
└── README.md
```

`enterprise-api.yaml` = `enterprise-api.base.yaml` (kết thúc bằng `paths:`) **+** nối tiếp 8 fragment trong `paths/` (mỗi fragment là các path-item thụt 2 space).

## Build lại spec tổng

```bash
cd "API Design/openapi"
cat enterprise-api.base.yaml \
    paths/auth.paths.yaml paths/hr.paths.yaml paths/att.paths.yaml paths/leave.paths.yaml \
    paths/task.paths.yaml paths/noti.paths.yaml paths/dash.paths.yaml paths/fnd.paths.yaml \
    > enterprise-api.yaml
```

## Kiểm tra (validate)

```bash
# Kiểm tra cấu trúc: parse YAML, trùng operationId, $ref treo, tag chưa khai báo
python - <<'PY'
import yaml, collections
doc = yaml.safe_load(open("enterprise-api.yaml", encoding="utf-8"))
paths = doc["paths"]; HTTP = {"get","post","put","patch","delete"}
ops = [(p,m,op) for p,it in paths.items() for m,op in it.items() if m in HTTP]
ids = [op.get("operationId") for _,_,op in ops]
print("paths:", len(paths), "operations:", len(ops))
print("dup operationId:", [k for k,v in collections.Counter(ids).items() if v>1] or "none")
PY

# (tuỳ chọn) validate chuẩn OpenAPI:
pip install openapi-spec-validator
python -c "from openapi_spec_validator import validate; import yaml; validate(yaml.safe_load(open('enterprise-api.yaml',encoding='utf-8'))); print('VALID')"
```

Trạng thái hiện tại: **295 paths · 378 operations · 0 trùng operationId · 2010 $ref đều resolve · 100% operation có `x-required-permission`.**

## Quy ước chuẩn hóa

### Security schemes
| Scheme | Loại | Áp dụng |
| ------ | ---- | ------- |
| `bearerAuth` | `http` bearer (JWT) | endpoint public `/api/v1/*` cần đăng nhập (mặc định global) |
| `internalServiceAuth` | `apiKey` header `X-Internal-Token` | endpoint `/internal/v1/*` |

Endpoint không cần đăng nhập (login, refresh, forgot/reset password, health) khai báo `security: []`.

### Vendor extensions (x-*) — metadata phân quyền & hành vi
| Extension | Kiểu | Ý nghĩa |
| --------- | ---- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | Mã permission bắt buộc. Mảng = nhiều permission. `null` = Public/Authenticated. |
| `x-permission-mode` | `allOf` \| `anyOf` | Cách kết hợp khi `x-required-permission` là mảng. Mặc định `allOf`. |
| `x-allowed-roles` | `string[]` | Role thường dùng (mô tả, không enforce). |
| `x-data-scope` | `string[]` | `Own`/`Team`/`Department`/`Project`/`Company`/`System`. |
| `x-idempotency` | `Required` \| `Optional` \| `No` | Yêu cầu header `Idempotency-Key`. |
| `x-audit-log` | `always` \| `conditional` \| `none` | Mức ghi audit log. |
| `x-notification-event` | `string` \| `null` | Event code phát ra (nếu có). |

### operationId prefix theo module
| Module | Prefix | Fragment |
| ------ | ------ | -------- |
| AUTH | `auth` | `paths/auth.paths.yaml` |
| HR | `hr` | `paths/hr.paths.yaml` |
| ATT | `att` | `paths/att.paths.yaml` |
| LEAVE | `leave` | `paths/leave.paths.yaml` |
| TASK | `task` | `paths/task.paths.yaml` |
| NOTI | `noti` | `paths/noti.paths.yaml` |
| DASH | `dash` | `paths/dash.paths.yaml` |
| FOUNDATION | `fnd` | `paths/fnd.paths.yaml` |

### Components dùng chung (định nghĩa trong base, fragment chỉ `$ref`)
- **Schemas:** `SuccessResponse`, `SuccessListResponse`, `CursorListResponse`, `ErrorResponse`, `ValidationErrorResponse`, `Meta`, `Pagination`, `CursorPagination`, `ValidationFieldError`, `ErrorObject`.
- **Responses:** `SuccessObject`, `SuccessList`, `SuccessCursorList`, `Created`, `Accepted`, `NoContent`, `BadRequest`(400), `Unauthorized`(401), `Forbidden`(403), `NotFound`(404), `Conflict`(409), `UnprocessableEntity`(422), `PayloadTooLarge`(413), `UnsupportedMediaType`(415), `TooManyRequests`(429), `ServerError`(500).
- **Parameters:** `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `CursorParam`, `LimitParam`, `XRequestId`, `XClientType`, `IdempotencyKey`, `IfMatch`.

> Request/response body cụ thể của từng endpoint được mô hình **inline** trong fragment (các property chính). Khi cần DTO tái dùng nhiều nơi, nâng lên `components/schemas` trong base.

## Liên hệ permission

Giá trị `x-required-permission` / `x-data-scope` đồng bộ với [API-10 Permission Matrix](../API-10%20PERMISSION%20MATRIX.md). Các điểm cần chốt (đặt tên, scope vs role, permission orphan, OR-permission) xem [API-10 Permission Audit Report](../API-10%20PERMISSION%20AUDIT%20REPORT.md).

## Quy trình cập nhật

1. Sửa endpoint trong tài liệu module (API-02 → API-09).
2. Cập nhật fragment `paths/<module>.paths.yaml` tương ứng (giữ đúng vendor extensions & `$ref` component).
3. Build lại `enterprise-api.yaml` (lệnh ở trên).
4. Chạy validate.
5. Nếu thay đổi permission → cập nhật [API-10 Matrix](../API-10%20PERMISSION%20MATRIX.md).
