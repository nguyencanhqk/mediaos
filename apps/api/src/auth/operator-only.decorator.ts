import { SetMetadata } from "@nestjs/common";

export const OPERATOR_ONLY = "OPERATOR_ONLY";

/**
 * AC-0b — đánh dấu route/controller CHỈ chấp nhận access token audience='operator' (phiên platform-admin
 * control-plane chéo tenant). JwtAuthGuard đọc cờ này: route @OperatorOnly verify với expectedAudience
 * 'operator' (token tenant/legacy bị 401); route KHÔNG đánh dấu mặc định 'tenant' (token operator bị 401).
 * Biên audience là phòng-thủ-theo-tầng song song với PermissionGuard — KHÔNG thay thế quyền.
 */
export const OperatorOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(OPERATOR_ONLY, true);
