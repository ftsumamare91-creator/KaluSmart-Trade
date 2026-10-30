import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SENSITIVE = /pass|token|secret|hash/i;
const redact = (v: any): any => {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(x)]));
};

@Injectable()
export class AuditService {
  private log = new Logger('Audit');
  constructor(private prisma: PrismaService) {}

  /** Audit failures must not break the business action, but they are logged loudly. */
  async record(e: { organizationId: string; userId?: string | null; action: string; entityType: string; entityId?: string; details?: unknown; ip?: string }) {
    try {
      await this.prisma.auditEvent.create({
        data: {
          organizationId: e.organizationId,
          userId: e.userId ?? null,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          details: redact(e.details) ?? undefined,
          ipAddress: e.ip,
        },
      });
    } catch (err) {
      this.log.error(`audit write failed: ${(err as Error).message}`);
    }
  }
}
