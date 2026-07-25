/**
 * S5-BE-CONTRACT-1 (WS-D §13) — Bản đồ MODULE cho OpenAPI tag.
 *
 * Mặc định @nestjs/swagger gắn tag = TÊN CLASS controller (`AuthLogsViewer`, `HrWrite`, …) ⇒ 78
 * controller thành ~78 nhóm rời rạc, không đọc được theo nghiệp vụ. WO yêu cầu "chuẩn hoá THEO MODULE"
 * (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation — CLAUDE.md §1) nên tag được suy lại từ SEGMENT ĐẦU của
 * route path (nguồn ổn định hơn tên class: đổi tên class không đổi hợp đồng URL).
 *
 * BẤT BIẾN CỦA REGISTRY: mỗi segment CHỈ thuộc đúng 1 module. Segment chưa khai → rơi vào
 * `UNCLASSIFIED_TAG`, và e2e (`openapi-contract.e2e-spec`) FAIL khi có bất kỳ operation nào rơi vào đó
 * ⇒ thêm module/route mới BẮT BUỘC khai ở đây, registry không âm thầm lạc hậu.
 */

/** Một module nghiệp vụ trong tài liệu API — tag + mô tả + các segment path thuộc về nó. */
export interface ApiModuleTag {
  /** Mã module theo SPEC-01 §9 (AUTH/HR/ATT/…) — giá trị của extension `x-module`. */
  code: string;
  /**
   * Tiền tố tag theo BACKEND-12 §9.1 (`Auth`, `HR`, `Attendance`…). Tag cuối cùng =
   * `<prefix> - <vùng nghiệp vụ>` (vùng suy từ tên controller) ⇒ Swagger UI xếp cạnh nhau theo
   * module NHƯNG vẫn giữ độ mịn để lọc — đúng cả hai yêu cầu §9.1 và §9.2.
   */
  tagPrefix: string;
  /** Mô tả nhóm (kèm SPEC nguồn). */
  description: string;
  /** Segment ĐẦU của route path (sau global prefix) thuộc module này. */
  segments: readonly string[];
}

/** Tiền tố cho route chưa phân loại — e2e coi đây là LỖI (xem ghi chú đầu file). */
export const UNCLASSIFIED_PREFIX = "Khác";

/**
 * Registry module → segment. Thứ tự phản ánh bảng module CLAUDE.md §1 (7 module MVP) rồi tới module bổ
 * sung đã ship (ME/GOAL) và nhóm hạ tầng. KHÔNG suy đoán segment: mọi giá trị dưới đây đối chiếu từ
 * openapi.json sinh thật (441 operation / 340 path).
 */
export const API_MODULE_TAGS: readonly ApiModuleTag[] = [
  {
    code: "AUTH",
    tagPrefix: "Auth",
    description:
      "Đăng nhập/đăng xuất, phiên, 2FA, người dùng, vai trò & phân quyền, API key (SPEC-02).",
    segments: ["auth", "users", "permissions", "api-keys"],
  },
  {
    code: "HR",
    tagPrefix: "HR",
    description:
      "Hồ sơ nhân sự, hợp đồng, tài liệu, cơ cấu tổ chức, vị trí, thùng rác nhân sự (SPEC-03).",
    segments: ["hr", "employees", "org", "recycle-bin"],
  },
  {
    code: "ATT",
    tagPrefix: "Attendance",
    description: "Check-in/out, bảng công, đơn điều chỉnh công, làm việc từ xa (SPEC-04).",
    segments: ["attendance"],
  },
  {
    code: "LEAVE",
    tagPrefix: "Leave",
    description: "Đơn nghỉ phép, phê duyệt, số dư phép, lịch nghỉ (SPEC-05).",
    segments: ["leave"],
  },
  {
    code: "TASK",
    tagPrefix: "Task",
    description: "Công việc, dự án, kanban, trạng thái, nhãn, bình luận & tệp đính kèm (SPEC-06).",
    segments: ["tasks", "projects", "states", "labels"],
  },
  {
    code: "DASH",
    tagPrefix: "Dashboard",
    description: "Dashboard theo vai trò, widget và cấu hình widget (SPEC-07).",
    segments: ["dashboard"],
  },
  {
    code: "NOTI",
    tagPrefix: "Notification",
    description: "Thông báo của tôi, tuỳ chọn nhận thông báo, cấu hình sự kiện/mẫu (SPEC-08).",
    segments: ["notifications"],
  },
  {
    code: "ME",
    tagPrefix: "Me",
    description: "Personal Hub — tổng hợp dữ liệu cá nhân xuyên module (SPEC-09).",
    segments: ["me"],
  },
  {
    code: "GOAL",
    tagPrefix: "Goal",
    description: "Cây mục tiêu phòng ban → dự án/nhân viên → công việc (SPEC-10).",
    segments: ["goals"],
  },
  {
    code: "FND",
    tagPrefix: "Foundation",
    description:
      "Cấu hình công ty, cài đặt, module catalog, ngày lễ, audit, lưu trữ tệp, health, tích hợp (SPEC-01).",
    segments: ["foundation", "settings", "health", "integrations"],
  },
  {
    code: "APPROVAL",
    tagPrefix: "Approval",
    description: "Hộp duyệt dùng chung (approval-request) + duyệt/từ chối theo cấp.",
    segments: ["approval"],
  },
  {
    code: "INTERNAL",
    tagPrefix: "Internal",
    description:
      "Endpoint nội bộ giữa các service (xác thực bằng internal key/API key), KHÔNG dành cho trình duyệt.",
    segments: ["internal"],
  },
  {
    code: "WORKFLOW",
    tagPrefix: "Workflow",
    description:
      "Quy trình theo content-item — di sản hướng media, ĐÃ PARK ngoài phạm vi sản phẩm (CLAUDE.md §1 reframe 2026-06-20). Không phát triển tiếp.",
    segments: ["workflow", "workflow-templates"],
  },
] as const;

/** Segment đầu của path (đã bỏ global prefix `api/v1` nếu có). Trả "" khi path rỗng/`/`. */
export function firstPathSegment(path: string, globalPrefix?: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  const prefixParts = (globalPrefix ?? "").split("/").filter((p) => p !== "");
  // Bỏ prefix chỉ khi path THỰC SỰ bắt đầu bằng nó (doc có thể sinh cả 2 dạng tuỳ useGlobalPrefix).
  const startsWithPrefix = prefixParts.length > 0 && prefixParts.every((p, i) => parts[i] === p);
  const rest = startsWithPrefix ? parts.slice(prefixParts.length) : parts;
  return rest[0] ?? "";
}

/** Index segment → module (dựng 1 lần; segment trùng ở 2 module là lỗi cấu hình, xem spec). */
const SEGMENT_INDEX: ReadonlyMap<string, ApiModuleTag> = new Map(
  API_MODULE_TAGS.flatMap((m) => m.segments.map((s) => [s, m] as const)),
);

/** Module của một route path. `null` khi segment chưa khai trong registry. */
export function moduleForPath(path: string, globalPrefix?: string): ApiModuleTag | null {
  return SEGMENT_INDEX.get(firstPathSegment(path, globalPrefix)) ?? null;
}

/**
 * Vùng nghiệp vụ (phần sau dấu gạch của tag) suy từ tên class controller: bỏ hậu tố `Controller` rồi
 * tách camelCase → `AuthLogsViewerController` → `Auth Logs Viewer`. Dùng tên class vì đó là đơn vị gom
 * nhóm sẵn có của code — KHÔNG cần bảng ánh xạ tay 78 dòng (bảng tay chắc chắn trôi).
 */
export function subAreaFromOperationId(operationId: string | undefined): string | null {
  const controller = operationId?.split("_")[0];
  if (controller === undefined || controller === "") return null;
  const base = controller.replace(/Controller$/, "");
  if (base === "") return null;
  return base
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/**
 * Tag của một operation theo BACKEND-12 §9.1: `<tiền tố module> - <vùng nghiệp vụ>`.
 * Segment chưa khai trong registry → tiền tố `Khác` (e2e coi là LỖI, xem ghi chú đầu file).
 */
export function tagForOperation(
  path: string,
  operationId: string | undefined,
  globalPrefix?: string,
): string {
  const prefix = moduleForPath(path, globalPrefix)?.tagPrefix ?? UNCLASSIFIED_PREFIX;
  const subArea = subAreaFromOperationId(operationId);
  return subArea === null ? prefix : `${prefix} - ${subArea}`;
}

/**
 * Khối `tags[]` cấp tài liệu. Tag là ĐỘNG (sinh theo controller có thật) nên danh sách được dựng TỪ
 * các tag đã dùng, mỗi tag mang mô tả của module chứa nó ⇒ Swagger UI luôn có mô tả, không bao giờ
 * lệch với tag thực tế trên operation.
 */
export function buildDocumentTags(
  usedTags: Iterable<string>,
): { name: string; description: string }[] {
  const descriptionByPrefix = new Map(API_MODULE_TAGS.map((m) => [m.tagPrefix, m.description]));
  return [...new Set(usedTags)]
    .sort((a, b) => a.localeCompare(b, "vi"))
    .map((name) => ({
      name,
      description: descriptionByPrefix.get(name.split(" - ")[0]) ?? "",
    }));
}
