import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  ATT_PERMISSIONS,
  ATT_RESOURCES,
  type AttPermissionPair,
  type AttResourceType,
} from "./attendance-permissions.const";
import { AttendanceShiftService } from "./attendance-shift.service";
import {
  CreateRuleDto,
  CreateShiftAssignmentDto,
  CreateShiftDto,
  EffectiveShiftRuleQueryDto,
  UpdateRuleDto,
  UpdateShiftDto,
} from "./attendance-shift.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/** Same fail-fast lookup as AttendanceController — pair MUST exist in the shared catalog (mig 0454). */
function attPair(action: string, resourceType: AttResourceType): AttPermissionPair {
  const pair = ATT_PERMISSIONS.find((p) => p.action === action && p.resourceType === resourceType);
  if (!pair) {
    throw new Error(`ATT permission pair missing from catalog: ${action}:${resourceType}`);
  }
  return pair;
}

const SHIFT_VIEW = attPair("view", ATT_RESOURCES.SHIFT);
const SHIFT_CREATE = attPair("create", ATT_RESOURCES.SHIFT);
const SHIFT_UPDATE = attPair("update", ATT_RESOURCES.SHIFT);
const ASSIGNMENT_VIEW = attPair("view", ATT_RESOURCES.SHIFT_ASSIGNMENT);
const ASSIGNMENT_UPDATE = attPair("update", ATT_RESOURCES.SHIFT_ASSIGNMENT);
const RULE_VIEW = attPair("view", ATT_RESOURCES.RULE);
const RULE_CONFIG = attPair("config", ATT_RESOURCES.RULE);

/**
 * S3-ATT-BE-3 — shift/rule/assignment HTTP surface (API-10 §5.4, SPEC-04 §23.4 ATT-API-017..025).
 * Every route gated by PermissionGuard (@RequirePermission, fail-closed) against the SAME catalog pairs
 * as AttendanceController (attendance-permissions.const = single source of truth). GET /rules/effective
 * is declared before the (nonexistent) generic GET /rules/:id — no Express route-shadow risk here since
 * there is no such param route, but the static path is grouped with the other resolve-effective reads
 * for readability. CRUD is MINIMUM scope (create/update only) — advanced ops = carry-over CO-S4-007.
 */
@Controller("attendance")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceShiftController {
  constructor(private readonly shiftService: AttendanceShiftService) {}

  // ─── shifts (ATT-API-017/018/019) ──────────────────────────────────────────

  @Get("shifts")
  @RequirePermission(SHIFT_VIEW.action, SHIFT_VIEW.resourceType, {
    isSensitive: SHIFT_VIEW.sensitive,
  })
  listShifts(@Req() req: AuthenticatedRequest) {
    return this.shiftService.listShifts(req.user.companyId).then((items) => ({ items }));
  }

  @Post("shifts")
  @RequirePermission(SHIFT_CREATE.action, SHIFT_CREATE.resourceType, {
    isSensitive: SHIFT_CREATE.sensitive,
  })
  createShift(@Req() req: AuthenticatedRequest, @Body() dto: CreateShiftDto) {
    return this.shiftService.createShift(req.user, dto);
  }

  @Patch("shifts/:id")
  @RequirePermission(SHIFT_UPDATE.action, SHIFT_UPDATE.resourceType, {
    isSensitive: SHIFT_UPDATE.sensitive,
  })
  updateShift(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shiftService.updateShift(req.user, id, dto);
  }

  // ─── shift_assignments (ATT-API-021/022) ───────────────────────────────────

  @Get("shift-assignments")
  @RequirePermission(ASSIGNMENT_VIEW.action, ASSIGNMENT_VIEW.resourceType, {
    isSensitive: ASSIGNMENT_VIEW.sensitive,
  })
  listShiftAssignments(@Req() req: AuthenticatedRequest) {
    return this.shiftService.listShiftAssignments(req.user.companyId).then((items) => ({ items }));
  }

  @Post("shift-assignments")
  @RequirePermission(ASSIGNMENT_UPDATE.action, ASSIGNMENT_UPDATE.resourceType, {
    isSensitive: ASSIGNMENT_UPDATE.sensitive,
  })
  createShiftAssignment(@Req() req: AuthenticatedRequest, @Body() dto: CreateShiftAssignmentDto) {
    return this.shiftService.createShiftAssignment(req.user, dto);
  }

  // ─── attendance_rules (ATT-API-023/024/025) ────────────────────────────────
  // GET /rules/effective declared BEFORE any future GET /rules/:id so a param route never shadows it.

  @Get("rules/effective")
  @RequirePermission(RULE_VIEW.action, RULE_VIEW.resourceType, { isSensitive: RULE_VIEW.sensitive })
  getEffectiveRule(@Req() req: AuthenticatedRequest, @Query() query: EffectiveShiftRuleQueryDto) {
    return this.shiftService.getEffectiveShiftRule(req.user, query);
  }

  @Get("rules")
  @RequirePermission(RULE_VIEW.action, RULE_VIEW.resourceType, { isSensitive: RULE_VIEW.sensitive })
  listRules(@Req() req: AuthenticatedRequest) {
    return this.shiftService.listRules(req.user.companyId).then((items) => ({ items }));
  }

  @Post("rules")
  @RequirePermission(RULE_CONFIG.action, RULE_CONFIG.resourceType, {
    isSensitive: RULE_CONFIG.sensitive,
  })
  createRule(@Req() req: AuthenticatedRequest, @Body() dto: CreateRuleDto) {
    return this.shiftService.createRule(req.user, dto);
  }

  @Patch("rules/:id")
  @RequirePermission(RULE_CONFIG.action, RULE_CONFIG.resourceType, {
    isSensitive: RULE_CONFIG.sensitive,
  })
  updateRule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateRuleDto,
  ) {
    return this.shiftService.updateRule(req.user, id, dto);
  }
}
