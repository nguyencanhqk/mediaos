/**
 * DEMO seed ĐẦY ĐỦ cho công ty "demo" — dữ liệu mẫu cho mọi màn sidebar web app.
 *
 * Chạy:  node "c:/dev 2/MediaOS/apps/api/demo-seed-full.mjs"
 *   (PHẢI chạy từ apps/api để ESM resolve được `pg` + `@node-rs/argon2`)
 *
 * Đặc tính:
 *   - IDEMPOTENT: chạy lại không nhân bản (SELECT-then-INSERT theo unique thật / ON CONFLICT).
 *   - Bất biến: mọi row có company_id = demo company. Bảng append-only (payslips/revenue/cost)
 *     chỉ INSERT khi chưa có. KHÔNG đụng company khác, KHÔNG đụng 16 task hiện có.
 *   - Mật khẩu user mới: Demo@12345 (argon2id, params khớp PasswordService).
 *   - BỎ platform_accounts (cần envelope encryption phía app).
 *
 * Không phải code sản phẩm — công cụ seed để thao tác/kiểm thử web app.
 */
import pg from "pg";
import { hash, Algorithm } from "@node-rs/argon2";

// SEED_DIRECT_URL override (vd dùng cho DB lane isolated: mediaos_projectspm). Mặc định = DB dev chung.
const DIRECT_URL =
  process.env.SEED_DIRECT_URL ?? "postgres://mediaos:changeme_dev_only@localhost:5432/mediaos";
const COMPANY_ID = "401c90a0-dfea-4b0a-986c-4317b798cd7b";
const ADMIN_ID = "31348071-d4e2-4723-a66d-3322e4ce85aa";
const USER_PASSWORD = "Demo@12345";
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const DAY = 24 * 60 * 60 * 1000;
const today = new Date("2026-06-17T00:00:00.000Z");
const day = (d) => new Date(today.getTime() + d * DAY);
const isoDate = (dt) => dt.toISOString().slice(0, 10); // YYYY-MM-DD

// System role ids (GLOBAL, seeded). Gán qua user_roles (company-scoped).
const ROLE = {
  companyAdmin: "00000000-0000-0000-0000-000000000001",
  projectManager: "00000000-0000-0000-0000-000000000002",
  channelManager: "00000000-0000-0000-0000-000000000003",
  scriptWriter: "00000000-0000-0000-0000-000000000004",
  editor: "00000000-0000-0000-0000-000000000005",
  qaReviewer: "00000000-0000-0000-0000-000000000006",
  uploader: "00000000-0000-0000-0000-000000000007",
  employee: "00000000-0000-0000-0000-000000000008",
  hrManager: "00000000-0000-0000-0000-000000000009",
  financeManager: "00000000-0000-0000-0000-00000000000a",
};

/** Helper: SELECT id theo điều kiện, trả id đầu hoặc null. */
async function selId(c, sql, params) {
  const r = await c.query(sql, params);
  return r.rows[0]?.id ?? null;
}

// ── 10 nhân sự mẫu (tên VN), gán phòng ban + chức vụ + role ────────────────────
const PEOPLE = [
  { email: "an.nguyen@demo.local", name: "Nguyễn Văn An", unit: "noi-dung", pos: "truong-phong-noi-dung", role: ROLE.projectManager, salary: 25000000, etype: "full_time" },
  { email: "binh.tran@demo.local", name: "Trần Thị Bình", unit: "noi-dung", pos: "bien-kich", role: ROLE.scriptWriter, salary: 15000000, etype: "full_time" },
  { email: "cuong.le@demo.local", name: "Lê Quốc Cường", unit: "san-xuat", pos: "dung-phim", role: ROLE.editor, salary: 16000000, etype: "full_time" },
  { email: "dung.pham@demo.local", name: "Phạm Tiến Dũng", unit: "san-xuat", pos: "dung-phim", role: ROLE.editor, salary: 15500000, etype: "full_time" },
  { email: "hoa.vo@demo.local", name: "Võ Thị Hoa", unit: "san-xuat", pos: "qa", role: ROLE.qaReviewer, salary: 17000000, etype: "full_time" },
  { email: "khanh.do@demo.local", name: "Đỗ Gia Khánh", unit: "kenh", pos: "quan-ly-kenh", role: ROLE.channelManager, salary: 20000000, etype: "full_time" },
  { email: "linh.bui@demo.local", name: "Bùi Mỹ Linh", unit: "kenh", pos: "uploader", role: ROLE.uploader, salary: 12000000, etype: "part_time" },
  { email: "minh.hoang@demo.local", name: "Hoàng Nhật Minh", unit: "nhan-su", pos: "truong-phong-hr", role: ROLE.hrManager, salary: 22000000, etype: "full_time" },
  { email: "nga.dang@demo.local", name: "Đặng Thúy Nga", unit: "tai-chinh", pos: "ke-toan-truong", role: ROLE.financeManager, salary: 23000000, etype: "full_time" },
  { email: "phuc.ngo@demo.local", name: "Ngô Hữu Phúc", unit: "noi-dung", pos: "bien-kich", role: ROLE.employee, salary: 13000000, etype: "probation" },
];

const ORG_UNITS = [
  { code: "noi-dung", name: "Phòng Nội Dung", type: "department" },
  { code: "san-xuat", name: "Phòng Sản Xuất", type: "department" },
  { code: "kenh", name: "Phòng Vận Hành Kênh", type: "department" },
  { code: "nhan-su", name: "Phòng Nhân Sự", type: "department" },
  { code: "tai-chinh", name: "Phòng Tài Chính", type: "department" },
];

const POSITIONS = [
  { code: "truong-phong-noi-dung", name: "Trưởng phòng Nội dung", unit: "noi-dung", level: 3 },
  { code: "bien-kich", name: "Biên kịch", unit: "noi-dung", level: 1 },
  { code: "dung-phim", name: "Kỹ thuật dựng phim", unit: "san-xuat", level: 1 },
  { code: "qa", name: "Kiểm duyệt chất lượng", unit: "san-xuat", level: 2 },
  { code: "quan-ly-kenh", name: "Quản lý kênh", unit: "kenh", level: 2 },
  { code: "uploader", name: "Nhân viên đăng tải", unit: "kenh", level: 1 },
  { code: "truong-phong-hr", name: "Trưởng phòng Nhân sự", unit: "nhan-su", level: 3 },
  { code: "ke-toan-truong", name: "Kế toán trưởng", unit: "tai-chinh", level: 3 },
];

const CHANNELS = [
  { code: "tech-review", name: "Tech Review VN", platform: "youtube", niche: "Công nghệ", lang: "vi", health: "healthy" },
  { code: "am-thuc-viet", name: "Ẩm Thực Việt", platform: "youtube", niche: "Ẩm thực", lang: "vi", health: "watching" },
  { code: "du-lich-bui", name: "Du Lịch Bụi", platform: "tiktok", niche: "Du lịch", lang: "vi", health: "healthy" },
  { code: "tin-cong-nghe", name: "Tin Công Nghệ Daily", platform: "facebook", niche: "Tin tức", lang: "vi", health: "declining" },
  { code: "podcast-khoi-nghiep", name: "Podcast Khởi Nghiệp", platform: "podcast", niche: "Kinh doanh", lang: "vi", health: "healthy" },
];

const PROJECTS = [
  { code: "series-tech-2026", name: "Series Đánh giá công nghệ 2026", type: "content_production", priority: "high" },
  { code: "tet-2026", name: "Chiến dịch nội dung Tết 2026", type: "growth_campaign", priority: "urgent" },
  { code: "am-thuc-mien-bac", name: "Series Ẩm thực miền Bắc", type: "content_production", priority: "medium" },
  { code: "tuyen-editor", name: "Tuyển dụng đội ngũ Editor", type: "recruitment", priority: "low" },
];

const CONTENT = [
  { code: "ct-iphone16", title: "Review iPhone 16 Pro Max chi tiết", project: "series-tech-2026", status: "in_production", pstatus: "in_production" },
  { code: "ct-laptop-gaming", title: "Top 5 laptop gaming đáng mua 2026", project: "series-tech-2026", status: "review", pstatus: "waiting_review" },
  { code: "ct-galaxy-s25", title: "Đánh giá Galaxy S25 Ultra", project: "series-tech-2026", status: "published", pstatus: "published" },
  { code: "ct-banh-chung", title: "Hướng dẫn gói bánh chưng ngày Tết", project: "tet-2026", status: "draft", pstatus: "planning" },
  { code: "ct-pho-bo", title: "Bí quyết nấu phở bò gia truyền", project: "am-thuc-mien-bac", status: "approved", pstatus: "approved" },
  { code: "ct-bun-cha", title: "Làm bún chả Hà Nội chuẩn vị", project: "am-thuc-mien-bac", status: "in_production", pstatus: "in_production" },
];

async function main() {
  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    const pwHash = await hash(USER_PASSWORD, ARGON);

    // ── ORG UNITS (idempotent theo code) ──────────────────────────────────────
    const unitId = {};
    for (const u of ORG_UNITS) {
      let id = await selId(c, `SELECT id FROM org_units WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`, [COMPANY_ID, u.code]);
      if (!id) id = await selId(c, `INSERT INTO org_units (company_id,name,type,code,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [COMPANY_ID, u.name, u.type, u.code]);
      unitId[u.code] = id;
    }

    // ── POSITIONS (idempotent theo code) ──────────────────────────────────────
    const posId = {};
    for (const p of POSITIONS) {
      let id = await selId(c, `SELECT id FROM positions WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`, [COMPANY_ID, p.code]);
      if (!id) id = await selId(c, `INSERT INTO positions (company_id,org_unit_id,name,code,level,status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`, [COMPANY_ID, unitId[p.unit], p.name, p.code, p.level]);
      posId[p.code] = id;
    }

    // ── USERS + employee_profiles + user_roles ────────────────────────────────
    const userId = {};
    for (const person of PEOPLE) {
      let id = await selId(c, `SELECT id FROM users WHERE company_id=$1 AND email=$2 AND deleted_at IS NULL`, [COMPANY_ID, person.email]);
      if (!id) {
        id = await selId(c, `INSERT INTO users (company_id,email,password_hash,full_name,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`, [COMPANY_ID, person.email, pwHash, person.name]);
      } else {
        await c.query(`UPDATE users SET password_hash=$1, full_name=$2 WHERE id=$3`, [pwHash, person.name, id]);
      }
      userId[person.email] = id;

      // employee profile (idempotent theo company+user active)
      const empExists = await selId(c, `SELECT id FROM employee_profiles WHERE company_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [COMPANY_ID, id]);
      if (!empExists) {
        const empCode = "NV-" + person.email.split("@")[0].toUpperCase().replace(".", "");
        await c.query(
          `INSERT INTO employee_profiles (company_id,user_id,employee_code,org_unit_id,position_id,employment_type,start_date,base_salary,salary_type,phone,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'monthly',$9,'active')`,
          [COMPANY_ID, id, empCode, unitId[person.unit], posId[person.pos] ?? null, person.etype, isoDate(day(-120)), person.salary, "09" + Math.floor(10000000 + Math.random() * 89999999)],
        );
      }

      // role grant (idempotent — check tồn tại)
      const hasRole = await selId(c, `SELECT id FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3`, [id, person.role, COMPANY_ID]);
      if (!hasRole) {
        await c.query(`INSERT INTO user_roles (user_id,role_id,company_id,granted_by) VALUES ($1,$2,$3,$4)`, [id, person.role, COMPANY_ID, ADMIN_ID]);
      }
    }

    // Gán admin role company-admin (để menu permission đầy đủ trên web)
    const adminHasRole = await selId(c, `SELECT id FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3`, [ADMIN_ID, ROLE.companyAdmin, COMPANY_ID]);
    if (!adminHasRole) await c.query(`INSERT INTO user_roles (user_id,role_id,company_id,granted_by) VALUES ($1,$2,$3,$4)`, [ADMIN_ID, ROLE.companyAdmin, COMPANY_ID, ADMIN_ID]);

    // ── WORK SCHEDULE (ca mặc định) + LEAVE TYPES ─────────────────────────────
    let scheduleId = await selId(c, `SELECT id FROM work_schedules WHERE company_id=$1 AND name=$2 AND deleted_at IS NULL`, [COMPANY_ID, "Ca hành chính"]);
    if (!scheduleId) {
      scheduleId = await selId(c, `INSERT INTO work_schedules (company_id,name,work_type,start_time,end_time,grace_minutes,is_default,status) VALUES ($1,$2,'fixed','08:30','17:30',15,true,'active') RETURNING id`, [COMPANY_ID, "Ca hành chính"]);
    }
    const leaveTypes = [
      { code: "annual", name: "Nghỉ phép năm", paid: true, quota: 12 },
      { code: "sick", name: "Nghỉ ốm", paid: true, quota: 30 },
      { code: "unpaid", name: "Nghỉ không lương", paid: false, quota: null },
    ];
    const leaveTypeId = {};
    for (const lt of leaveTypes) {
      let id = await selId(c, `SELECT id FROM leave_types WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`, [COMPANY_ID, lt.code]);
      if (!id) id = await selId(c, `INSERT INTO leave_types (company_id,name,code,paid,annual_quota,status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`, [COMPANY_ID, lt.name, lt.code, lt.paid, lt.quota]);
      leaveTypeId[lt.code] = id;
    }

    // ── ATTENDANCE (vài nhân viên x 7 ngày gần đây) ───────────────────────────
    const attPeople = [PEOPLE[1], PEOPLE[2], PEOPLE[3], PEOPLE[4]]; // 4 nhân viên
    for (const person of attPeople) {
      const uid = userId[person.email];
      for (let d = -7; d <= -1; d++) {
        const wd = day(d);
        if (wd.getUTCDay() === 0 || wd.getUTCDay() === 6) continue; // bỏ cuối tuần
        const exists = await selId(c, `SELECT id FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`, [COMPANY_ID, uid, isoDate(wd)]);
        if (exists) continue;
        const late = Math.random() < 0.2 ? Math.floor(5 + Math.random() * 20) : 0;
        const status = late > 0 ? "late" : "present";
        const checkIn = new Date(wd.getTime() + (8 * 60 + 30 + late) * 60 * 1000);
        const checkOut = new Date(wd.getTime() + 17 * 60 * 60 * 1000 + 35 * 60 * 1000);
        await c.query(
          `INSERT INTO attendance_records (company_id,user_id,work_date,work_schedule_id,check_in_at,check_out_at,check_in_method,check_out_method,late_minutes,status)
           VALUES ($1,$2,$3,$4,$5,$6,'web','web',$7,$8)`,
          [COMPANY_ID, uid, isoDate(wd), scheduleId, checkIn.toISOString(), checkOut.toISOString(), late, status],
        );
      }
    }

    // ── LEAVE REQUESTS (vài cái) ──────────────────────────────────────────────
    const leaves = [
      { email: PEOPLE[1].email, type: "annual", start: day(3), end: day(4), days: 2, reason: "Về quê có việc gia đình", status: "pending" },
      { email: PEOPLE[2].email, type: "sick", start: day(-3), end: day(-3), days: 1, reason: "Sốt cao", status: "approved" },
      { email: PEOPLE[9].email, type: "unpaid", start: day(10), end: day(12), days: 3, reason: "Việc cá nhân", status: "pending" },
    ];
    for (const lv of leaves) {
      const uid = userId[lv.email];
      const exists = await selId(c, `SELECT id FROM leave_requests WHERE company_id=$1 AND user_id=$2 AND leave_type_id=$3 AND start_date=$4 AND deleted_at IS NULL`, [COMPANY_ID, uid, leaveTypeId[lv.type], isoDate(lv.start)]);
      if (exists) continue;
      const approvedBy = lv.status === "approved" ? userId[PEOPLE[7].email] : null; // HR manager
      const approvedAt = lv.status === "approved" ? day(-4).toISOString() : null;
      await c.query(
        `INSERT INTO leave_requests (company_id,user_id,leave_type_id,start_date,end_date,total_days,reason,status,approved_by,approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [COMPANY_ID, uid, leaveTypeId[lv.type], isoDate(lv.start), isoDate(lv.end), lv.days, lv.reason, lv.status, approvedBy, approvedAt],
      );
    }

    // ── CHANNELS (cần platform text + platform_id FK) ─────────────────────────
    const platRows = await c.query(`SELECT id, code FROM platforms`);
    const platformId = Object.fromEntries(platRows.rows.map((r) => [r.code, r.id]));
    const channelId = {};
    for (const ch of CHANNELS) {
      let id = await selId(c, `SELECT id FROM channels WHERE company_id=$1 AND name=$2 AND deleted_at IS NULL`, [COMPANY_ID, ch.name]);
      if (!id) {
        id = await selId(c,
          `INSERT INTO channels (company_id,name,platform,platform_id,code,niche,language,channel_manager_id,health_status,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
          [COMPANY_ID, ch.name, ch.platform, platformId[ch.platform], ch.code, ch.niche, ch.lang, userId[PEOPLE[5].email], ch.health]);
      }
      channelId[ch.code] = id;
    }

    // ── PROJECTS ──────────────────────────────────────────────────────────────
    const projectId = {};
    for (const p of PROJECTS) {
      let id = await selId(c, `SELECT id FROM projects WHERE company_id=$1 AND name=$2 AND deleted_at IS NULL`, [COMPANY_ID, p.name]);
      if (!id) {
        id = await selId(c,
          `INSERT INTO projects (company_id,name,code,project_type,priority,org_unit_id,owner_user_id,project_manager_id,start_date,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
          [COMPANY_ID, p.name, p.code, p.type, p.priority, unitId["noi-dung"], userId[PEOPLE[0].email], userId[PEOPLE[0].email], isoDate(day(-60))]);
      }
      projectId[p.code] = id;
    }

    // ── CONTENT ITEMS ─────────────────────────────────────────────────────────
    const contentId = {};
    for (const ct of CONTENT) {
      let id = await selId(c, `SELECT id FROM content_items WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`, [COMPANY_ID, ct.code]);
      if (!id) {
        id = await selId(c,
          `INSERT INTO content_items (company_id,project_id,title,code,status,production_status,owner_user_id,main_channel_id,language,priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'vi','medium') RETURNING id`,
          [COMPANY_ID, projectId[ct.project], ct.title, ct.code, ct.status, ct.pstatus, userId[PEOPLE[1].email], channelId["tech-review"]]);
      }
      contentId[ct.code] = id;
    }

    // ── WORKFLOW: definition + steps, 1 instance đang chạy ────────────────────
    const WF_STEPS = [
      { order: 1, code: "script", name: "Viết kịch bản", nodeKey: "n_script", title: "Viết kịch bản video" },
      { order: 2, code: "produce", name: "Quay & dựng", nodeKey: "n_produce", title: "Quay và dựng video" },
      { order: 3, code: "qa", name: "Kiểm duyệt QA", nodeKey: "n_qa", title: "Kiểm duyệt chất lượng" },
      { order: 4, code: "publish", name: "Đăng tải", nodeKey: "n_publish", title: "Đăng tải lên kênh" },
    ];
    let wfDefId = await selId(c, `SELECT id FROM workflow_definitions WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`, [COMPANY_ID, "wf-video-standard"]);
    if (!wfDefId) {
      wfDefId = await selId(c,
        `INSERT INTO workflow_definitions (company_id,code,name,applies_to,status,version,is_active,created_by)
         VALUES ($1,'wf-video-standard','Quy trình sản xuất video chuẩn','content_item','published',1,true,$2) RETURNING id`,
        [COMPANY_ID, ADMIN_ID]);
      for (const s of WF_STEPS) {
        await c.query(
          `INSERT INTO workflow_definition_steps (company_id,workflow_definition_id,step_order,code,name,default_task_title,node_key,step_type,is_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'task',true)`,
          [COMPANY_ID, wfDefId, s.order, s.code, s.name, s.title, s.nodeKey]);
      }
    }
    // instance gắn vào 1 content đang sản xuất (exactly-one content XOR project)
    const wfContent = contentId["ct-iphone16"];
    let wfInstId = await selId(c, `SELECT id FROM workflow_instances WHERE company_id=$1 AND content_item_id=$2 AND status='active'`, [COMPANY_ID, wfContent]);
    if (!wfInstId) {
      wfInstId = await selId(c,
        `INSERT INTO workflow_instances (company_id,workflow_definition_id,content_item_id,current_step_order,status,definition_version,created_by)
         VALUES ($1,$2,$3,2,'active',1,$4) RETURNING id`,
        [COMPANY_ID, wfDefId, wfContent, ADMIN_ID]);
      const stepStatuses = ["approved", "in_progress", "not_started", "not_started"];
      const assignees = [userId[PEOPLE[1].email], userId[PEOPLE[2].email], userId[PEOPLE[4].email], userId[PEOPLE[6].email]];
      for (let i = 0; i < WF_STEPS.length; i++) {
        const s = WF_STEPS[i];
        await c.query(
          `INSERT INTO workflow_steps (company_id,workflow_instance_id,step_order,step_code,step_name,status,assignee_user_id,node_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [COMPANY_ID, wfInstId, s.order, s.code, s.name, stepStatuses[i], assignees[i], s.nodeKey]);
      }
    }

    // ── PAYROLL: salary_profiles + 1 period + payslips ────────────────────────
    for (const person of PEOPLE) {
      const uid = userId[person.email];
      const exists = await selId(c, `SELECT id FROM salary_profiles WHERE company_id=$1 AND user_id=$2 AND status='active' AND deleted_at IS NULL`, [COMPANY_ID, uid]);
      if (!exists) {
        await c.query(
          `INSERT INTO salary_profiles (company_id,user_id,salary_type,pay_cycle,effective_date,base_salary,allowances,currency,status)
           VALUES ($1,$2,'monthly','monthly',$3,$4,$5,'VND','active')`,
          [COMPANY_ID, uid, isoDate(day(-120)), person.salary, JSON.stringify([{ name: "Phụ cấp ăn trưa", amount: 730000 }])]);
      }
    }
    const periodMonth = "2026-05";
    let periodId = await selId(c, `SELECT id FROM payroll_periods WHERE company_id=$1 AND period_month=$2 AND deleted_at IS NULL`, [COMPANY_ID, periodMonth]);
    if (!periodId) {
      periodId = await selId(c,
        `INSERT INTO payroll_periods (company_id,period_month,status,created_by,approved_by,approved_at,published_by,published_at)
         VALUES ($1,$2,'published',$3,$3,$4,$3,$4) RETURNING id`,
        [COMPANY_ID, periodMonth, ADMIN_ID, day(-15).toISOString()]);
    }
    // payslips: append-only — chỉ INSERT nếu chưa có original cho (period,user)
    for (const person of PEOPLE) {
      const uid = userId[person.email];
      const exists = await selId(c, `SELECT id FROM payslips WHERE company_id=$1 AND payroll_period_id=$2 AND user_id=$3 AND entry_kind='original'`, [COMPANY_ID, periodId, uid]);
      if (exists) continue;
      const allowances = 730000;
      const gross = person.salary + allowances;
      const net = Math.round(gross * 0.895); // trừ BHXH/thuế ước lượng
      await c.query(
        `INSERT INTO payslips (company_id,payroll_period_id,user_id,base_salary,total_allowances,gross,net,currency,work_days,present_days,late_minutes,entry_kind,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'VND',22,22,0,'original',$8)`,
        [COMPANY_ID, periodId, uid, person.salary, allowances, gross, net, ADMIN_ID]);
    }

    // ── FINANCE: revenue_records + cost_records (append-only, INSERT nếu chưa có)
    const revenues = [
      { source: "youtube_adsense", amount: 45000000, channel: "tech-review", desc: "Doanh thu AdSense kênh Tech Review T5" },
      { source: "youtube_adsense", amount: 28000000, channel: "am-thuc-viet", desc: "Doanh thu AdSense kênh Ẩm Thực T5" },
      { source: "sponsorship", amount: 60000000, channel: "tech-review", desc: "Tài trợ booking review điện thoại" },
      { source: "tiktok", amount: 12000000, channel: "du-lich-bui", desc: "Doanh thu TikTok Creator Fund" },
      { source: "affiliate", amount: 8500000, channel: "tech-review", desc: "Hoa hồng affiliate link sản phẩm" },
    ];
    for (const rv of revenues) {
      const exists = await selId(c, `SELECT id FROM revenue_records WHERE company_id=$1 AND description=$2 AND entry_kind='original'`, [COMPANY_ID, rv.desc]);
      if (exists) continue;
      await c.query(
        `INSERT INTO revenue_records (company_id,platform_id,channel_id,amount,currency,revenue_date,source,description,entered_by,entry_kind)
         VALUES ($1,$2,$3,$4,'VND',$5,$6,$7,$8,'original')`,
        [COMPANY_ID, null, channelId[rv.channel], rv.amount, isoDate(day(-20)), rv.source, rv.desc, userId[PEOPLE[8].email]]);
    }
    const costs = [
      { type: "salary", amount: 180000000, desc: "Chi phí lương nhân sự T5" },
      { type: "freelancer", amount: 15000000, desc: "Thuê freelancer dựng phim dự án Tết" },
      { type: "software", amount: 6000000, desc: "Gói Adobe Creative Cloud + CapCut Pro" },
      { type: "equipment", amount: 35000000, desc: "Mua máy quay Sony A7IV" },
      { type: "ads", amount: 20000000, desc: "Chạy quảng cáo push video mới" },
    ];
    for (const ct of costs) {
      const exists = await selId(c, `SELECT id FROM cost_records WHERE company_id=$1 AND description=$2 AND entry_kind='original'`, [COMPANY_ID, ct.desc]);
      if (exists) continue;
      await c.query(
        `INSERT INTO cost_records (company_id,cost_type,amount,currency,cost_date,description,entered_by,entry_kind)
         VALUES ($1,$2,$3,'VND',$4,$5,$6,'original')`,
        [COMPANY_ID, ct.type, ct.amount, isoDate(day(-18)), ct.desc, userId[PEOPLE[8].email]]);
    }

    // ── NOTIFICATIONS cho admin (vài cái) ─────────────────────────────────────
    const notifs = [
      { type: "approval_requested", body: "Lê Quốc Cường gửi duyệt video 'Top 5 laptop gaming 2026'" },
      { type: "task_submitted", body: "Trần Thị Bình hoàn thành kịch bản 'Review iPhone 16 Pro Max'" },
      { type: "general", body: "Kỳ lương tháng 05/2026 đã được công bố" },
      { type: "revision_requested", body: "Video 'Vlog Sài Gòn về đêm' bị trả lại chỉnh màu" },
    ];
    for (const n of notifs) {
      const exists = await selId(c, `SELECT id FROM notifications WHERE company_id=$1 AND user_id=$2 AND body=$3`, [COMPANY_ID, ADMIN_ID, n.body]);
      if (exists) continue;
      await c.query(`INSERT INTO notifications (company_id,user_id,type,body,is_read) VALUES ($1,$2,$3,$4,false)`, [COMPANY_ID, ADMIN_ID, n.type, n.body]);
    }

    // ── MEETINGS (vài cái) + attendees ────────────────────────────────────────
    const meetings = [
      { title: "Họp kế hoạch nội dung tháng 7", start: day(2), durH: 1.5, status: "scheduled", attendees: [PEOPLE[0].email, PEOPLE[1].email, PEOPLE[5].email] },
      { title: "Review chất lượng video tuần 24", start: day(1), durH: 1, status: "scheduled", attendees: [PEOPLE[2].email, PEOPLE[3].email, PEOPLE[4].email] },
      { title: "Họp tổng kết doanh thu T5", start: day(-5), durH: 2, status: "completed", attendees: [PEOPLE[8].email, PEOPLE[0].email] },
    ];
    for (const m of meetings) {
      let mid = await selId(c, `SELECT id FROM meetings WHERE company_id=$1 AND title=$2 AND deleted_at IS NULL`, [COMPANY_ID, m.title]);
      if (!mid) {
        const starts = new Date(m.start.getTime() + 9 * 60 * 60 * 1000); // 9h sáng
        const ends = new Date(starts.getTime() + m.durH * 60 * 60 * 1000);
        mid = await selId(c,
          `INSERT INTO meetings (company_id,title,starts_at,ends_at,organizer_id,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [COMPANY_ID, m.title, starts.toISOString(), ends.toISOString(), ADMIN_ID, m.status]);
        for (const email of m.attendees) {
          await c.query(`INSERT INTO meeting_attendees (company_id,meeting_id,user_id,rsvp) VALUES ($1,$2,$3,'accepted') ON CONFLICT DO NOTHING`, [COMPANY_ID, mid, userId[email]]);
        }
      }
    }

    await c.query("COMMIT");
    console.log("✓ Seed COMMIT thành công.\n");

    // ── ĐẾM CUỐI ──────────────────────────────────────────────────────────────
    const counts = [
      ["org_units", "company_id=$1 AND deleted_at IS NULL"],
      ["positions", "company_id=$1 AND deleted_at IS NULL"],
      ["users", "company_id=$1 AND deleted_at IS NULL"],
      ["employee_profiles", "company_id=$1 AND deleted_at IS NULL"],
      ["user_roles", "company_id=$1"],
      ["work_schedules", "company_id=$1 AND deleted_at IS NULL"],
      ["leave_types", "company_id=$1 AND deleted_at IS NULL"],
      ["attendance_records", "company_id=$1 AND deleted_at IS NULL"],
      ["leave_requests", "company_id=$1 AND deleted_at IS NULL"],
      ["channels", "company_id=$1 AND deleted_at IS NULL"],
      ["projects", "company_id=$1 AND deleted_at IS NULL"],
      ["content_items", "company_id=$1 AND deleted_at IS NULL"],
      ["workflow_definitions", "company_id=$1 AND deleted_at IS NULL"],
      ["workflow_definition_steps", "company_id=$1"],
      ["workflow_instances", "company_id=$1"],
      ["workflow_steps", "company_id=$1"],
      ["salary_profiles", "company_id=$1 AND deleted_at IS NULL"],
      ["payroll_periods", "company_id=$1 AND deleted_at IS NULL"],
      ["payslips", "company_id=$1"],
      ["revenue_records", "company_id=$1"],
      ["cost_records", "company_id=$1"],
      ["notifications", "company_id=$1"],
      ["meetings", "company_id=$1 AND deleted_at IS NULL"],
      ["meeting_attendees", "company_id=$1"],
      ["tasks", "company_id=$1"],
    ];
    console.log("── Đếm dòng cho công ty demo ──");
    for (const [tbl, where] of counts) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE ${where}`, [COMPANY_ID]);
      console.log(`  ${tbl.padEnd(28)} ${r.rows[0].n}`);
    }
    console.log(`\nĐăng nhập user mới:  companySlug=demo  password=${USER_PASSWORD}  (vd email an.nguyen@demo.local)`);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("✗ SEED LỖI:", e.message); console.error(e.stack); process.exit(1); });
