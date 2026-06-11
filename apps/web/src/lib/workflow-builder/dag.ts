import type {
  DagErrorDto,
  DagValidationResultDto,
  DependencyDto,
  TemplateStepDto,
} from "./contract";

/**
 * Validator DAG phía client — MIRROR rút gọn của `DagValidatorService` (LUỒNG B, 2a).
 * Dùng cho: (a) phản hồi tức thì khi build (nút Validate, canvas 2c),
 * (b) mock publish gate khi BE chưa ship.
 * Khi BE ship, kết quả từ server là nguồn chuẩn — validator này vẫn hữu ích cho UX tức thì.
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
    return { valid: false, errors: [{ code: "EMPTY", message: "Template chưa có bước nào." }] };
  }

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const nodeKeyById = new Map(steps.map((s) => [s.id, s.nodeKey]));

  // Cạnh hợp lệ (cả 2 đầu tồn tại) — dùng cho phần còn lại của validator.
  const validEdges: { from: string; to: string }[] = [];

  for (const dep of deps) {
    const fromExists = stepById.has(dep.fromStepId);
    const toExists = stepById.has(dep.toStepId);

    if (dep.fromStepId === dep.toStepId) {
      errors.push({
        code: "SELF_DEP",
        message: "Một bước không thể tự phụ thuộc vào chính nó.",
        nodeKey: nodeKeyById.get(dep.fromStepId) ?? null,
        fromStepId: dep.fromStepId,
        toStepId: dep.toStepId,
      });
      continue;
    }

    if (!fromExists || !toExists) {
      errors.push({
        code: "MISSING_DEP_TARGET",
        message: "Phụ thuộc trỏ tới một bước không còn tồn tại.",
        fromStepId: dep.fromStepId,
        toStepId: dep.toStepId,
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
    errors.push({ code: "CYCLE", message: "Đồ thị có chu trình phụ thuộc (A→…→A)." });
  }

  // ≥1 root (node không có cạnh đi vào).
  if (roots.length === 0 && steps.length > 0) {
    errors.push({ code: "NO_ROOT", message: "Mọi bước đều phụ thuộc — thiếu bước gốc khởi đầu." });
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
          code: "ORPHAN",
          message: `Bước "${s.title}" không nối được tới bước gốc nào.`,
          nodeKey: s.nodeKey,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
