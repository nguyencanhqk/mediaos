-- Migration 0498: S5-NOTI-FIX-2 (🔴 RED, zone=red) — TASK code-gen SEED + BACKFILL tasks.task_code.
--   QA2-CRIT-002 (docs/plans/S4-QA-2.md, vòng SỬA sau Đội-3 fail): TASK_COMMENT_CREATED · TASK_MENTIONED
--   render '{task_code}' câm vì tasks.task_code = NULL cho MỌI task tạo qua API — migration 0478 (§369) tạo
--   cột task_code + partial-unique uq_tasks_company_task_code_active NHƯNG code-gen CHƯA cut-over (insertTaskCoreTx
--   / HR createApprovalTaskTx KHÔNG ghi task_code; không default/trigger/sequence). Migration này là PHẦN DB của
--   remediation (a): (1) seed 1 sequence_counters 'task' per company để wiring createTask gọi
--   SequenceService.nextCode được; (2) backfill task_code cho task NULL-còn-sống (task cũ tạo trước cut-over vẫn
--   phải hiện mã, không '{task_code}'). Wiring createTask→nextCode = lane khác (apps/api/src/tasks/**).
--
-- CONTRACT khoá cho lane wiring (đối chiếu — PHẢI khớp seed này, nếu không nextCode ném SequenceNotFoundError):
--   sequence_key = 'task' · scope_type = 'Company' · module_code = 'TASK' · reset_policy = 'Never'.
--   Format = mirror employee-code (DB-01 §task_code KHÔNG chốt format cụ thể — VARCHAR "Mã task"): prefix
--   'TASK-' + zero-pad(current_value, 4) ⇒ TASK-0001, TASK-0002… (KHÔNG datePattern, giống EMPLOYEE_CODE
--   prefix+numberLength). Config-source = counter row NÀY (BẤT BIẾN "KHÔNG hard-code trong service" — service
--   chỉ đọc counter, render = SequenceService.buildCode(prefix+pad(value)) khớp 1:1 với backfill dưới đây).
--
-- BỐI CẢNH RLS/FORCE (seed+backfill qua migrator owner, KHÔNG qua app role — mirror 0497:8-12):
--   sequence_counters (0434) + tasks (task_code cột 0478) đã RLS ENABLE + FORCE + policy tenant_isolation TẠO
--   TRƯỚC (BẤT BIẾN #1 / CLAUDE.md §3 — RLS+FORCE TRƯỚC backfill). 0498 KHÔNG tạo bảng, KHÔNG đụng
--   RLS/policy/grant. Migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ INSERT/UPDATE
--   row tenant-scoped chạy TRỰC TIẾP, KHÔNG cần SET LOCAL/GUC; WITH CHECK(company_id=GUC) của 0434 chỉ chặn
--   app role. company_id ĐƯỢC ghi/lọc TƯỜNG MINH ở mọi câu (defense-in-depth — BẤT BIẾN #1).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id tường minh mọi INSERT/UPDATE/JOIN (không dựa GUC — owner bypass). RLS+FORCE của 0434/0478
--      giữ nguyên. #2 KHÔNG hard-delete: chỉ INSERT counter + UPDATE in-place task_code (giữ id/row). #3
--      task_code = mã hiển thị non-sensitive (KHÔNG secret/PII) — chỉ vào body/title notification, KHÔNG vào
--      target_url (route dùng {taskId} UUID — xem 0497). #5 counter dùng cột có sẵn (uuid PK, timestamptz UTC).
--   • IDEMPOTENT: seed ON CONFLICT DO NOTHING (bare — bắt cả partial-unique
--     uq_sequence_counters_company_key_scope_active); backfill CHỈ task_code IS NULL (chạy lại 0 hàng);
--     start_base = GREATEST(counter.current_value, MAX mã 'TASK-<n>' đã có) ⇒ KHÔNG đè, KHÔNG trùng
--     uq_tasks_company_task_code_active, gap OK (mirror allocateEmployeeCode).
--   • KHÔNG db:generate: thuần DATA (INSERT/UPDATE) — không biểu diễn được bằng Drizzle schema (mirror 0490/0497).
--
-- BAND 0498 (lane notifix2-migr-taskcode / S5-NOTI-FIX-2). Journal: idx 178, when 1717500885000 (> head 0497
--   idx 177 / 1717500880000). Nối tiếp ĐƠN ĐIỆU sau 0497_s5_notifix1_backfill_target_url_template.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Format tập trung 1 chỗ (KHÔNG rải hằng số → chống drift giữa seed/backfill/sync). Đổi format = đổi ở đây.
  v_module   CONSTANT text := 'TASK';
  v_seq_key  CONSTANT text := 'task';
  v_scope    CONSTANT text := 'Company';   -- CHECK chk_sequence_counters_scope_type IN (...,'Company',...)
  v_prefix   CONSTANT text := 'TASK-';
  v_padding  CONSTANT int  := 4;
  v_reset    CONSTANT text := 'Never';     -- CHECK chk_sequence_counters_reset_policy IN ('Never',...)
  v_re       CONSTANT text := '^' || v_prefix || '\d+$';       -- match mã 'TASK-<số>' đã có (backfill/manual)
  v_cap      CONSTANT text := '^' || v_prefix || '(\d+)$';     -- bắt nhóm số để parse MAX
  v_seeded   int;
  v_filled   int;
  v_synced   int;
BEGIN
  -- ── (1) SEED counter 'task' cho MỌI company (kể cả company chưa có task — sẵn cho createTask sau). ──
  --     ON CONFLICT DO NOTHING (bare) idempotent với partial-unique (company_id,sequence_key,scope,scope_ref).
  --     current_value=0 ⇒ mã đầu (nextCode) = TASK-0001; backfill (3) sẽ nâng current_value theo task cũ.
  INSERT INTO sequence_counters (
    company_id, module_code, sequence_key, scope_type,
    prefix, padding_length, reset_policy, increment_by, current_value, status
  )
  SELECT c.id, v_module, v_seq_key, v_scope,
         v_prefix, v_padding, v_reset, 1, 0, 'Active'
    FROM companies c
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_seeded = ROW_COUNT;

  -- ── (2) BACKFILL task_code cho task NULL-còn-sống, theo TỪNG company ORDER BY created_at (rồi id ổn định). ──
  --     start_base per company = GREATEST(counter hiện tại, MAX số của mã 'TASK-<n>' đã có) ⇒ tránh đè/trùng
  --     uq_tasks_company_task_code_active + gap OK. Mã = prefix + lpad(base+rn, padding) — KHỚP buildCode.
  WITH base AS (
    SELECT c.id AS company_id,
           GREATEST(
             COALESCE(sc.current_value, 0),
             COALESCE((
               SELECT MAX((substring(t2.task_code FROM v_cap))::bigint)
                 FROM tasks t2
                WHERE t2.company_id = c.id
                  AND t2.deleted_at IS NULL
                  AND t2.task_code ~ v_re
             ), 0)
           ) AS start_base
      FROM companies c
      LEFT JOIN sequence_counters sc
        ON sc.company_id = c.id
       AND sc.sequence_key = v_seq_key
       AND sc.scope_type = v_scope
       AND sc.deleted_at IS NULL
  ),
  to_fill AS (
    SELECT t.id, t.company_id,
           row_number() OVER (PARTITION BY t.company_id ORDER BY t.created_at, t.id) AS rn
      FROM tasks t
     WHERE t.deleted_at IS NULL
       AND t.task_code IS NULL
  )
  UPDATE tasks tk
     SET task_code  = v_prefix || lpad((b.start_base + tf.rn)::text, v_padding, '0'),
         updated_at = now()
    FROM to_fill tf
    JOIN base b ON b.company_id = tf.company_id
   WHERE tk.id = tf.id
     AND tk.company_id = tf.company_id;   -- company_id tường minh (BẤT BIẾN #1)
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  -- ── (3) SYNC counter current_value = MAX số đã cấp per company (để nextCode kế tiếp nối tiếp, không trùng). ──
  --     CHỈ nâng khi cần (u.max_num > current_value) hoặc chưa có last_generated_code ⇒ chạy lại = no-op.
  WITH used AS (
    SELECT t.company_id,
           MAX((substring(t.task_code FROM v_cap))::bigint) AS max_num
      FROM tasks t
     WHERE t.deleted_at IS NULL
       AND t.task_code ~ v_re
     GROUP BY t.company_id
  )
  UPDATE sequence_counters sc
     SET current_value       = GREATEST(sc.current_value, u.max_num),
         last_generated_code = v_prefix || lpad(GREATEST(sc.current_value, u.max_num)::text, v_padding, '0'),
         updated_at          = now()
    FROM used u
   WHERE sc.company_id  = u.company_id
     AND sc.sequence_key = v_seq_key
     AND sc.scope_type   = v_scope
     AND sc.deleted_at IS NULL
     AND (u.max_num > sc.current_value OR sc.last_generated_code IS NULL);
  GET DIAGNOSTICS v_synced = ROW_COUNT;

  RAISE NOTICE '[0498] TASK seq-gen: % counter seeded, % task backfilled, % counter synced',
    v_seeded, v_filled, v_synced;
END;
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFY fail-LOUD: 0 task CÒN-SỐNG còn task_code NULL (điều kiện để renderer KHÔNG rớt '{task_code}' câm).
--   RAISE EXCEPTION kèm count → migration ĐỎ, chặn deploy nửa vời. Idempotent: lần 2 vẫn 0 NULL.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_null_alive int;
  v_no_counter int;
BEGIN
  SELECT count(*) INTO v_null_alive
    FROM tasks
   WHERE deleted_at IS NULL AND task_code IS NULL;
  IF v_null_alive > 0 THEN
    RAISE EXCEPTION '[0498] % task còn-sống vẫn task_code NULL sau backfill (QA2-CRIT-002 chưa vá hết)', v_null_alive;
  END IF;

  SELECT count(*) INTO v_no_counter
    FROM companies c
   WHERE NOT EXISTS (
     SELECT 1 FROM sequence_counters sc
      WHERE sc.company_id = c.id
        AND sc.sequence_key = 'task'
        AND sc.scope_type = 'Company'
        AND sc.deleted_at IS NULL
   );
  IF v_no_counter > 0 THEN
    RAISE EXCEPTION '[0498] % company thiếu counter task sau seed (code-gen createTask sẽ 404)', v_no_counter;
  END IF;

  RAISE NOTICE '[0498] verify OK — 0 task còn-sống NULL task_code, mọi company có counter task.';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Revert = xoá code backfill + counter task.
-- --   CHỈ chạy nếu cần rollback code-gen TASK toàn hệ thống (mã đã hiển thị cho user → cân nhắc kỹ).
-- UPDATE tasks SET task_code = NULL, updated_at = now()
--  WHERE deleted_at IS NULL AND task_code ~ '^TASK-\d+$';
-- UPDATE sequence_counters SET deleted_at = now()
--  WHERE sequence_key = 'task' AND scope_type = 'Company' AND deleted_at IS NULL;
