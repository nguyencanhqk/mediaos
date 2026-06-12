import type {
  DagErrorDto,
  DagValidationResultDto,
  DependencyDto,
  TemplateStepDto,
} from "./contract";

/**
 * Validator DAG phía client — MIRROR rút gọn của `DagValidatorService` (LUỒNG B, 2a).
 * Mã lỗi + hình dạng khớp contract FROZEN (`dagValidationResultSchema`): mỗi lỗi có
 * `code` (lowercase) + `message` + `nodeKeys[]`.
 *
 * Dùng cho: (a) phản hồi tức thì khi build (nút Kiểm tra DAG, canvas 2c),
 * (b) DỰNG LẠI danh sách lỗi inline sau publish 422 — vì AllExceptionsFilter của BE DẸP
 *     payload `dagValidation`, client chạy lại validator này trên steps/deps đang hiển thị.
 *
 * PURE + immutable: không sửa input, trả về object/mảng mới.
 * Quy ước cạnh: dep.fromStepId = tiền nhiệm (chạy trước), dep.toStepId = phụ thuộc (chạy sau).
 * → cạnh from→to; root = node KHÔNG có cạnh đi VÀO (không phụ thuộc ai).
 */
export function validateDag(
  steps: readonly TemplateStepDto[],
  deps: readonly DependencyDto[],
): DagValidationResultDto {
  const errors: DagErrorDto[] = [];

  if (steps.length === 0) {
    return {
      valid: false,
      errors: [{ code: "no_root", message: "Quy trình chưa có bước nào — thêm ít nhất một bước.", nodeKeys: [] }],
    };
  }

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const nodeKeyById = new Map(steps.map((s) => [s.id, s.nodeKey]));

  // Cạnh hợp lệ (cả 2 đầu tồn tại) — dùng cho phần còn lại của validator.
  const validEdges: { from: string; to: string }[] = [];

  for (const dep of deps) {
    const fromExists = stepById.has(dep.fromStepId);
    const toExists = stepById.has(dep.toStepId);

    if (dep.fromStepId === dep.toStepId) {
      const key = nodeKeyById.get(dep.fromStepId);
      errors.push({
        code: "self_dependency",
        message: "Một bước không thể tự phụ thuộc vào chính nó.",
        nodeKeys: key ? [key] : [],
      });
      continue;
    }

    if (!fromExists || !toExists) {
      errors.push({
        code: "missing_node",
        message: "Phụ thuộc trỏ tới một bước không còn tồn tại.",
        nodeKeys: [],
      });
      continue;
    }

    validEdges.push({ from: dep.fromStepId, to: dep.toStepId });
  }

  // Kề (adjacency) + bậc vào (in-degree).
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const s of steps) {
    adjacency.set(s.id, []);
    inDegree.set(s.id, 0);
  }
  for (const e of validEdges) {
    adjacency.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // Cycle detection bằng Kahn topo-sort: nếu không xử lý hết node → có chu trình.
  const queue = steps.filter((s) => (inDegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  const roots = [...queue];
  const remaining = new Map(inDegree);
  let processed = 0;
  const work = [...queue];
  while (work.length > 0) {
    const id = work.shift()!;
    processed += 1;
    for (const next of adjacency.get(id) ?? []) {
      const d = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, d);
      if (d === 0) work.push(next);
    }
  }
  const hasCycle = processed < steps.length;
  if (hasCycle) {
    errors.push({ code: "cycle", message: "Đồ thị có chu trình phụ thuộc (A→…→A).", nodeKeys: [] });
  }

  // ≥1 root (node không có cạnh đi vào).
  if (roots.length === 0 && steps.length > 0) {
    errors.push({
      code: "no_root",
      message: "Mọi bước đều phụ thuộc — thiếu bước gốc khởi đầu.",
      nodeKeys: [],
    });
  }

  // Reachability: mọi node phải reachable từ một root (chỉ kiểm khi không có chu trình).
  if (!hasCycle && roots.length > 0) {
    const reachable = new Set<string>();
    const stack = [...roots];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of adjacency.get(id) ?? []) stack.push(next);
    }
    for (const s of steps) {
      if (!reachable.has(s.id)) {
        errors.push({
          code: "unreachable",
          message: `Bước "${s.name}" không nối được tới bước gốc nào.`,
          nodeKeys: [s.nodeKey],
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
