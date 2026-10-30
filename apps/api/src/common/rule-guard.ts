import { BadRequestException } from '@nestjs/common';
import { RuleError } from '../finance/rule-error';

function toHttp(e: unknown): unknown {
  if (e instanceof RuleError) return new BadRequestException({ code: e.code, message: e.message });
  return e;
}

/** Runs a synchronous rule check; a refusal becomes a 400 carrying a stable code and a safe message. */
export function ruleGuard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw toHttp(e);
  }
}

/** Async version for code that writes inside a transaction. */
export async function ruleGuardAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toHttp(e);
  }
}
