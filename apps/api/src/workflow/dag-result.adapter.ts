import { InternalServerErrorException } from "@nestjs/common";
import type { DagErrorCodeDto, DagValidationResultDto } from "@mediaos/contracts";
import {
  DAG_ERROR_CODE,
  type DagDep,
  type DagErrorCode,
  type DagStep,
  type DagValidationResult,
} from "./dag-validator.service";

/**
 * G7-2b — the "thin adapter" between persisted template rows and the FROZEN
 * DAG contract (the dag-validator header calls for this on merge). PURE: no I/O,
 * never mutates inputs.
 *
 * Two responsibilities, kept separate so each is independently testable:
 *   1. `buildDagInput` — persisted step/dep rows → validator port (keyed by node_key).
 *   2. `toDagValidationResultDto` — validator's own error codes → frozen contract codes.
 */

/** Persisted step row fields needed to identify a DAG node. */
interface PersistedStep {
  readonly id: string;
  readonly nodeKey: string;
}

/** Persisted dependency row fields (edges are stored by step id, not node_key). */
interface PersistedDep {
  readonly fromStepId: string;
  readonly toStepId: string;
}

/**
 * Builds the node_key-keyed input the DagValidatorService consumes from persisted
 * rows, resolving each edge's step ids to node_keys.
 *
 * INVARIANT: every dependency endpoint references a live step of the SAME template
 * (FK `onDelete: cascade` + the add-time guard in 1c-iii). So the id→node_key map is
 * total. A missing endpoint means the DB invariant is broken — we THROW rather than
 * silently drop the edge, which would mask a real cycle/orphan at publish time.
 */
export function buildDagInput(
  steps: readonly PersistedStep[],
  deps: readonly PersistedDep[],
): { steps: DagStep[]; deps: DagDep[] } {
  const nodeKeyByStepId = new Map(steps.map((step) => [step.id, step.nodeKey]));

  const dagDeps = deps.map((dep) => {
    const fromNodeKey = nodeKeyByStepId.get(dep.fromStepId);
    const toNodeKey = nodeKeyByStepId.get(dep.toStepId);
    if (fromNodeKey === undefined || toNodeKey === undefined) {
      throw new InternalServerErrorException(
        "Dependency references a step that is not part of the template (integrity violation)",
      );
    }
    return { fromNodeKey, toNodeKey };
  });

  return { steps: steps.map((step) => ({ nodeKey: step.nodeKey })), deps: dagDeps };
}

/**
 * Maps a DagValidatorService error code (LUỒNG B owns these) to the FROZEN contract
 * code (`packages/contracts` 1b). Exhaustive: adding a new service code without a
 * mapping is a compile error here.
 *
 * `DUPLICATE_NODE_KEY` has no contract equivalent — and cannot occur on PERSISTED
 * steps (unique index `wf_def_steps_def_node_key_uq`). If it ever fires, the DB
 * uniqueness invariant is broken: surface it loudly instead of mislabeling it.
 */
function toContractCode(code: DagErrorCode): DagErrorCodeDto {
  switch (code) {
    case DAG_ERROR_CODE.CYCLE_DETECTED:
      return "cycle";
    case DAG_ERROR_CODE.SELF_DEPENDENCY:
      return "self_dependency";
    case DAG_ERROR_CODE.UNKNOWN_NODE:
      return "missing_node";
    case DAG_ERROR_CODE.UNREACHABLE_NODE:
      return "unreachable";
    case DAG_ERROR_CODE.NO_ROOT:
      return "no_root";
    case DAG_ERROR_CODE.DUPLICATE_NODE_KEY:
      throw new InternalServerErrorException(
        "Duplicate node_key in a persisted template (unique-index invariant violated)",
      );
  }
}

/** Validator result → frozen contract DTO. Drops the service-only `edge` field. */
export function toDagValidationResultDto(result: DagValidationResult): DagValidationResultDto {
  return {
    valid: result.valid,
    errors: result.errors.map((error) => ({
      code: toContractCode(error.code),
      message: error.message,
      nodeKeys: error.nodeKeys ? [...error.nodeKeys] : [],
    })),
  };
}
