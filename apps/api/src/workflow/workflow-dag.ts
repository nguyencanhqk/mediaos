/**
 * Workflow DAG resolution — G7-3c (pure logic, NO DB access).
 *
 * Core invariant (§1.3): "A step is startable when ALL its upstream dependencies are approved."
 *   - Sequential = linear dependency chain (A→B→C→D).
 *   - Parallel (fork) = B and C both depend on A → when A approved, both open.
 *   - Join = D depends on both B and C → D opens only when both approved.
 *
 * Resolution key: `node_key` (canonical template identity) with `step_code` fallback for legacy
 * G4-3 rows whose `workflow_steps.node_key` was never set. Template dependencies reference
 * `workflow_definition_steps.id`; we map def-step id → node_key → instance step by key.
 *
 * Callers (workflow.service start/submit, approval.service approve) load defSteps + deps +
 * instanceSteps WITHIN their transaction and pass them here, so the FSM/service stays pure.
 */

import type { StepStatus } from "./workflow.types";

const APPROVED_STATUS: StepStatus = "approved";
const NOT_STARTED_STATUS: StepStatus = "not_started";

/** A template step (workflow_definition_steps), at the instance's pinned definition_version. */
export interface DagDefStep {
  id: string;
  nodeKey: string;
  /** is_required — only required steps count toward workflow completion (G7-3c-ii). */
  isRequired: boolean;
}

/** A template DAG edge (workflow_step_dependencies): from upstream → to downstream. */
export interface DagDependency {
  fromStepId: string;
  toStepId: string;
}

/** An instance step (workflow_steps). node_key may be null for legacy rows → fall back to step_code. */
export interface DagInstanceStep {
  id: string;
  nodeKey: string | null;
  stepCode: string;
  status: string;
}

/** Everything needed to resolve dependency state for one instance, read within one tx. */
export interface DagContext {
  defSteps: DagDefStep[];
  deps: DagDependency[];
  instanceSteps: DagInstanceStep[];
}

/** Join key for an instance step: node_key is canonical; step_code is the legacy fallback. */
export function instanceStepKey(step: { nodeKey: string | null; stepCode: string }): string {
  return step.nodeKey ?? step.stepCode;
}

/**
 * True when every upstream dependency of `target` is `approved`.
 * A step with no incoming edges (root) → true. Fail-closed (false) if `target` or any upstream
 * edge cannot be resolved to a def-step (key mismatch / dangling edge) — never open a step we
 * cannot reason about.
 *
 * Assumes instance-step keys are unique per instance — guaranteed because instance steps are
 * snapshotted 1:1 from def-steps, which carry uq(workflow_definition_id, node_key). `.find()` by
 * key is therefore unambiguous. `target` only needs its key (its own status is irrelevant here).
 */
export function allDependenciesApproved(
  target: { nodeKey: string | null; stepCode: string },
  ctx: DagContext,
): boolean {
  const targetDef = ctx.defSteps.find((d) => d.nodeKey === instanceStepKey(target));
  if (!targetDef) return false;

  const upstreamDefIds = ctx.deps
    .filter((dep) => dep.toStepId === targetDef.id)
    .map((dep) => dep.fromStepId);
  if (upstreamDefIds.length === 0) return true; // root — nothing to wait on

  return upstreamDefIds.every((defId) => {
    const upstreamDef = ctx.defSteps.find((d) => d.id === defId);
    if (!upstreamDef) return false; // dangling edge → fail-closed
    const upstreamStep = ctx.instanceSteps.find(
      (s) => instanceStepKey(s) === upstreamDef.nodeKey,
    );
    return upstreamStep?.status === APPROVED_STATUS;
  });
}

/**
 * Steps that become startable as a direct result of `justApproved` reaching `approved` (G7-3c-ii).
 * Walks the DAG edges leaving `justApproved`; for each downstream def-step, returns the matching
 * instance step's id when it is still `not_started` AND all of its upstream deps are now approved.
 *
 * Fail-closed: if `justApproved` cannot be resolved to a def-step, opens nothing; dangling/absent
 * downstream rows are skipped. `ctx` MUST reflect the POST-approve view (caller re-reads instance
 * steps after writing `justApproved`→approved) so `allDependenciesApproved` sees the fresh status.
 */
export function computeNewlyUnblockedStepIds(
  justApproved: { nodeKey: string | null; stepCode: string },
  ctx: DagContext,
): string[] {
  const approvedDef = ctx.defSteps.find((d) => d.nodeKey === instanceStepKey(justApproved));
  if (!approvedDef) return []; // cannot resolve the just-approved step → fail-closed

  const downstreamDefIds = ctx.deps
    .filter((dep) => dep.fromStepId === approvedDef.id)
    .map((dep) => dep.toStepId);

  const unblocked: string[] = [];
  for (const defId of downstreamDefIds) {
    const downDef = ctx.defSteps.find((d) => d.id === defId);
    if (!downDef) continue; // dangling edge → skip
    const instStep = ctx.instanceSteps.find((s) => instanceStepKey(s) === downDef.nodeKey);
    if (!instStep || instStep.status !== NOT_STARTED_STATUS) continue; // absent or already opened/done
    if (allDependenciesApproved({ nodeKey: instStep.nodeKey, stepCode: instStep.stepCode }, ctx)) {
      unblocked.push(instStep.id);
    }
  }
  return unblocked;
}

/**
 * Instance-step IDs of ALL transitive descendants of `source` — every step reachable by following
 * dep edges (from → to) downstream from `source`. Drives revision-lock propagation (G7-4a / BR-006):
 * revising step N blocks exactly its descendants, never independent branches (LK2).
 *
 * BFS over def-step ids; `visitedDefIds` stops a diamond join (D reachable via B and C) from being
 * walked twice. Fail-closed: an unresolvable `source` returns [] (locks nothing). Dangling downstream
 * edges and def-steps with no matching instance step are skipped. `source` itself is never included.
 */
export function computeTransitiveDescendants(
  source: { nodeKey: string | null; stepCode: string },
  ctx: DagContext,
): string[] {
  const sourceDef = ctx.defSteps.find((d) => d.nodeKey === instanceStepKey(source));
  if (!sourceDef) return []; // cannot resolve the source → fail-closed (lock nothing)

  const visitedDefIds = new Set<string>([sourceDef.id]);
  const queue: string[] = [sourceDef.id];
  const descendantInstanceIds: string[] = [];

  while (queue.length > 0) {
    const currentDefId = queue.shift() as string;
    const downstreamDefIds = ctx.deps
      .filter((dep) => dep.fromStepId === currentDefId)
      .map((dep) => dep.toStepId);
    for (const defId of downstreamDefIds) {
      if (visitedDefIds.has(defId)) continue; // already walked (diamond join) → skip
      visitedDefIds.add(defId);
      queue.push(defId);
      const downDef = ctx.defSteps.find((d) => d.id === defId);
      if (!downDef) continue; // dangling edge → skip
      const instStep = ctx.instanceSteps.find((s) => instanceStepKey(s) === downDef.nodeKey);
      if (!instStep) continue; // def-step has no instance step (absent) → skip
      descendantInstanceIds.push(instStep.id);
    }
  }
  return descendantInstanceIds;
}

/**
 * True when the workflow has nothing left to do: every REQUIRED instance step is `approved`
 * (G7-3c-ii). Completion is driven by all-required-approved, NOT by max step_order — a fork can
 * complete on a non-terminal-order step. Optional steps (is_required=false) never block completion.
 *
 * Fail-closed: an instance step whose def-step cannot be resolved is treated as blocking (never
 * auto-complete on an unknown step); an empty instance never completes.
 */
export function isWorkflowComplete(ctx: DagContext): boolean {
  if (ctx.instanceSteps.length === 0) return false;
  return ctx.instanceSteps.every((s) => {
    const def = ctx.defSteps.find((d) => d.nodeKey === instanceStepKey(s));
    if (!def) return false; // unknown step → fail-closed
    if (!def.isRequired) return true; // optional step doesn't block completion
    return s.status === APPROVED_STATUS;
  });
}
