export const meta = {
  name: 'gap-analysis-mvp',
  description:
    'Phân tích KHOẢNG CÁCH spec/docs ↔ code thật cho từng module MVP (FOUNDATION·AUTH·HR·ATT·LEAVE·TASK·NOTI·DASH·FE·INTEGRATION·QA). Mỗi agent đọc docs (SPEC/BACKEND/FRONTEND/API/DB) + code module + backlog hiện tại, trả về Work Orders đề xuất (id·zone·paths·depends_on·done_when·effort) để chủ phiên tổng hợp vào harness/backlog.mjs. READ-ONLY: KHÔNG sửa code.',
  phases: [{ title: 'Analyze', detail: 'tech-lead read-only: 1 agent/module → gap + Work Orders đề xuất' }],
};

const WO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['module', 'codeState', 'summary', 'workOrders'],
  properties: {
    module: { type: 'string' },
    codeState: { type: 'string', enum: ['none', 'stub', 'partial', 'substantial', 'wrong-shape'], description: 'mức độ code MVP đã tồn tại cho module này so với spec' },
    summary: { type: 'string', description: '2-4 câu: cái gì ĐÃ có trong code, cái gì THIẾU/lệch spec, rủi ro bất biến' },
    workOrders: {
      type: 'array',
      description: 'các Work Order codeable còn THIẾU (KHÔNG liệt việc đã done). Rỗng nếu module đã đủ.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'layer', 'zone', 'builder', 'paths', 'depends_on', 'done_when', 'effort'],
        properties: {
          id: { type: 'string', description: 'mã ngắn ổn định, VD HR-BE-1 / ATT-FE-2 / LEAVE-DB-1' },
          title: { type: 'string' },
          layer: { type: 'string', enum: ['db', 'be', 'fe', 'qa', 'integration'] },
          zone: { type: 'string', enum: ['green', 'yellow', 'red'], description: 'red nếu chạm permission/RLS/secret/audit/auth/migration/FSM phê duyệt; yellow nếu đọc dữ liệu nhạy cảm/mask; green = CRUD/UI thường' },
          builder: { type: 'string', enum: ['db-migration', 'backend-builder', 'frontend-builder', 'qa-test-engineer'] },
          paths: { type: 'array', items: { type: 'string' }, description: 'glob file/vùng được phép đụng' },
          depends_on: { type: 'array', items: { type: 'string' }, description: 'id WO khác phải done trước (trong/ngoài module)' },
          done_when: { type: 'array', items: { type: 'string' }, description: '2-4 tiêu chí hội tụ kiểm thử được, trỏ về spec/story ID' },
          effort: { type: 'string', enum: ['S', 'M', 'L', 'XL'] },
          refs: { type: 'array', items: { type: 'string' }, description: 'epic/story/API/DB ID nguồn (VD EPIC-04, ATT-API-003)' },
        },
      },
    },
  },
};

// Mỗi module: docs để đọc + code dir để soi. Path có dấu cách → agent dùng Read/Grep (xử lý được).
const MODULES = [
  {
    key: 'FOUNDATION', epic: 'EPIC-01',
    docs: ['docs/BACKEND/BACKEND-04_Foundation_Backend.md', 'docs/BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md', 'docs/DB/DB-08 Audit Files Settings Seeds Database Design.md', 'docs/API Design/API-09_FOUNDATION_API_Design.md'],
    code: ['apps/api/src/config', 'apps/api/src/settings', 'apps/api/src/storage', 'apps/api/src/events', 'apps/api/src/platform', 'apps/api/src/db/schema'],
  },
  {
    key: 'AUTH', epic: 'EPIC-02',
    docs: ['docs/spec/SPEC-02 AUTH.md', 'docs/BACKEND/BACKEND-03_Auth_Session_RBAC_Permission_Guard.md', 'docs/API Design/API-02 AUTH API Design.md', 'docs/DB/DB-02 AUTH RBAC Database Design.md', 'docs/permission-matrix-spec.md'],
    code: ['apps/api/src/auth', 'apps/api/src/permission', 'apps/api/src/users', 'apps/api/src/user-invites', 'apps/api/src/security-policy'],
  },
  {
    key: 'HR', epic: 'EPIC-03',
    docs: ['docs/spec/SPEC-03 HR.md', 'docs/BACKEND/BACKEND-05_HR_Backend.md', 'docs/API Design/API-03_HR_API_Design.md', 'docs/DB/DB-03_HR Database Design.md'],
    code: ['apps/api/src/employees', 'apps/api/src/org', 'apps/api/src/positions'],
  },
  {
    key: 'ATT', epic: 'EPIC-04',
    docs: ['docs/spec/SPEC-04 ATT.md', 'docs/BACKEND/BACKEND-06_Attendance_Backend.md', 'docs/API Design/API-04_ATT_API_Design.md', 'docs/DB/DB-04_ATT Database Design.md'],
    code: ['apps/api/src/attendance'],
  },
  {
    key: 'LEAVE', epic: 'EPIC-05',
    docs: ['docs/spec/SPEC-05 LEAVE.md', 'docs/BACKEND/BACKEND-07_Leave_Backend.md', 'docs/API Design/API-05_LEAVE_API_Design.md', 'docs/DB/DB-05 LEAVE Database Design.md'],
    code: ['apps/api/src/leave'],
  },
  {
    key: 'TASK', epic: 'EPIC-06',
    docs: ['docs/spec/SPEC-06 TASK.md', 'docs/BACKEND/BACKEND-08_Task_Backend.md', 'docs/API Design/API-06_TASK_API_Design.md', 'docs/DB/DB-06 TASK Database Design.md'],
    code: ['apps/api/src/tasks', 'apps/api/src/approval', 'apps/api/src/workflow'],
  },
  {
    key: 'NOTI', epic: 'EPIC-07',
    docs: ['docs/spec/SPEC-08 NOTI.md', 'docs/BACKEND/BACKEND-09_Notification_Backend.md', 'docs/API Design/API-07_NOTI_API_Design.md', 'docs/DB/DB-07 NOTI DASH Database Design.md'],
    code: ['apps/api/src/notifications'],
  },
  {
    key: 'DASH', epic: 'EPIC-08',
    docs: ['docs/spec/SPEC-07 DASH.md', 'docs/BACKEND/BACKEND-10_Dashboard_Backend.md', 'docs/API Design/API-08_DASH_API_Design.md', 'docs/DB/DB-07 NOTI DASH Database Design.md'],
    code: ['apps/api/src/dashboard'],
  },
  {
    key: 'FE-CORE', epic: 'EPIC-09',
    docs: ['docs/FRONTEND/FRONTEND-01_Frontend_Architecture_Project_Setup.md', 'docs/FRONTEND/FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md', 'docs/FRONTEND/FRONTEND-04_API_Client_Query_Layer_Error_Handling.md', 'docs/FRONTEND/FRONTEND-05_Layout_Implementation.md'],
    code: ['apps/app', 'apps/auth', 'apps/console', 'apps/web', 'packages/web-core', 'packages/ui'],
  },
  {
    key: 'FE-MODULES', epic: 'EPIC-09/module-FE',
    docs: ['docs/FRONTEND/FRONTEND-08_HR_Frontend.md', 'docs/FRONTEND/FRONTEND-09_Attendance_Frontend.md', 'docs/FRONTEND/FRONTEND-10_Leave_Frontend.md', 'docs/FRONTEND/FRONTEND-11_Task_Frontend.md', 'docs/FRONTEND/FRONTEND-12_Notification_Frontend.md', 'docs/FRONTEND/FRONTEND-07_Dashboard_Frontend.md'],
    code: ['apps/app', 'apps/people', 'apps/projects', 'apps/studio'],
  },
  {
    key: 'INTEGRATION', epic: 'EPIC-10',
    docs: ['docs/QA/QA-05_Permission_Role_Data_Scope_Testing.md', 'docs/API Design/API-10 PERMISSION MATRIX.md', 'docs/BACKEND/BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md'],
    code: ['apps/api/src/attendance', 'apps/api/src/leave', 'apps/api/src/notifications', 'apps/api/src/dashboard', 'apps/api/src/storage'],
  },
  {
    key: 'QA-RELEASE', epic: 'EPIC-11',
    docs: ['docs/QA/QA-01_QA_Strategy_And_Test_Plan.md', 'docs/QA/QA-02_Test_Case_Matrix_theo_module.md', 'docs/QA/QA-03_End-to-End_Flow_Testing.md', 'docs/BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md'],
    code: ['apps/api/src', 'apps/api/test'],
  },
];

const prompt = (m) =>
  [
    `Bạn là tech-lead MediaOS. Phân tích KHOẢNG CÁCH cho module ${m.key} (${m.epic}) — spec/docs ĐÃ viết ↔ CODE thật.`,
    ``,
    `BƯỚC 1 — đọc docs nguồn (đây là "đã viết sẵn", là CHUẨN sản phẩm):`,
    ...m.docs.map((d) => `  • ${d}`),
    `BƯỚC 2 — soi code thật đã tồn tại:`,
    ...m.code.map((c) => `  • ${c}/`),
    `BƯỚC 3 — đọc harness/backlog.mjs để KHÔNG đề xuất trùng việc đã 'done'/'in_progress'.`,
    ``,
    `Bối cảnh QUAN TRỌNG (CLAUDE.md): dự án ĐÃ de-media-fy → chỉ 7 module MVP (AUTH·HR·ATT·LEAVE·TASK·DASH·NOTI). Backend nền G1–G16 đã land (RLS·permission·audit·outbox). Nhiều module code có sẵn NHƯNG có thể: (a) build dưới hướng media cũ, lệch spec; (b) thiếu màn/luồng; (c) đúng rồi. FE phân mảnh (apps cũ admin/people/projects/studio/web), CHƯA có apps/app hợp nhất.`,
    ``,
    `NHIỆM VỤ: xác định codeState + liệt kê Work Order CÒN THIẾU để đạt spec MVP. Với mỗi WO:`,
    `  - id ngắn (VD ${m.key}-BE-1/${m.key}-FE-1/${m.key}-DB-1); layer (db|be|fe|qa|integration); builder phù hợp.`,
    `  - zone: ĐỎ nếu chạm permission/RLS/secret/audit/auth/migration/FSM phê duyệt (fail-closed: nghi ngờ→đỏ); VÀNG nếu đọc dữ liệu nhạy cảm cần mask; XANH = CRUD/UI thường.`,
    `  - paths: glob vùng file ĐƯỢC đụng (bám cây code thật đã soi). depends_on: id WO khác (kể cả module khác theo dependency FOUNDATION→AUTH→HR→ATT/LEAVE→TASK/NOTI/DASH).`,
    `  - done_when: 2-4 tiêu chí HỘI TỤ kiểm thử được, TRỎ về story/API/DB ID trong docs. effort S/M/L/XL. refs: epic/story nguồn.`,
    `  - migration PHẢI tách lane builder='db-migration' (RLS+FORCE trước backfill).`,
    `CHỈ liệt việc CÒN THIẾU/lệch — KHÔNG liệt việc đã hoàn chỉnh. Nếu module đã đủ → workOrders rỗng + nói rõ trong summary.`,
    ``,
    `ĐỌC TIẾT KIỆM (chống rate-limit): KHÔNG đọc trọn cây code lớn. Dùng Glob liệt kê file, Grep tìm controller/service/route/@RequirePermission, Read CHỈ phần liên quan (header service, danh sách endpoint, schema cột). Mục tiêu: đủ kết luận codeState + gap, KHÔNG nuốt nguyên file dài.`,
    `READ-ONLY tuyệt đối: KHÔNG sửa/tạo file. Trả DUY NHẤT object theo schema.`,
  ].join('\n');

phase('Analyze');
// Chạy theo MẺ NHỎ (3 module/lượt, nối tiếp giữa các mẻ) để KHÔNG burst → tránh rate-limit 429.
const BATCH = 3;
const results = [];
for (let i = 0; i < MODULES.length; i += BATCH) {
  const wave = MODULES.slice(i, i + BATCH);
  log(`Mẻ ${i / BATCH + 1}: ${wave.map((m) => m.key).join(', ')}`);
  const part = await parallel(wave.map((m) => () => agent(prompt(m), { agentType: 'tech-lead', schema: WO_SCHEMA, label: `gap:${m.key}`, phase: 'Analyze' })));
  results.push(...part);
}

const clean = results.filter(Boolean);
const allWO = clean.flatMap((r) => (r.workOrders || []).map((w) => ({ ...w, module: r.module })));
log(`Gap-analysis xong: ${clean.length}/${MODULES.length} module · ${allWO.length} Work Order đề xuất.`);

return {
  modules: clean.map((r) => ({ module: r.module, codeState: r.codeState, summary: r.summary, count: (r.workOrders || []).length })),
  workOrders: allWO,
  totals: { modules: clean.length, workOrders: allWO.length },
};
