import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'isPublic';
export const PERM_KEY = 'permission';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermission = (p: Permission) => SetMetadata(PERM_KEY, p);

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
  sessionId: string;
}

/** The user and tenant come only from the validated session, never from request input. */
export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUser =>
  ctx.switchToHttp().getRequest().user,
);
