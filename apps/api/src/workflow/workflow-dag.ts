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

/** A template step (workflow_definition_steps), at the instance's pinned definition_version. */
export interface DagDefStep {
  id: string;
  nodeKey: string;
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
