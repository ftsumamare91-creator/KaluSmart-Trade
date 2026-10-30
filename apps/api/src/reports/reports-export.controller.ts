import { BadRequestException, Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { ruleGuard } from '../common/rule-guard';
import { reportOffsetMinutes, resolveRange } from '../analytics/analytics-rules';
import { can } from '../common/permissions';
import { safeFilename, toCsv } from './csv';

/** Largest export. Bigger requests are refused rather than loading unbounded data into memory. */
const MAX_ROWS = 10_000;
const MAX_DAYS = 366;

const TYPES: Record<string, { permission: 'sales:read' | 'expenses:read' | 'products:read'; dated: boolean }> = {
  sales: { permission: 'sales:read', dated: true },
  expenses: { permission: 'expenses:read', dated: true },
  inventory: { permission: 'products:read', dated: false },
};

/**
 * CSV exports of existing records. The rows come from the same tables the screens use, scoped to the caller's
 * organization. Permissions are checked per type, so the export never reveals more than the matching screen does.
 * Excel can open these files directly; this avoids adding a spreadsheet library.
 */
@Controller('reports/export')
export class ReportExportController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get(':type')
  async export(
    @Me() me: CurrentUser,
    @Param('type') type: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const def = TYPES[type];
    if (!def) throw new BadRequestException('Unknown report type');
    // Permission is checked here, using the same matrix as the rest of the API.
    if (!can(me.role, def.permission)) throw new BadRequestException('You do not have access to this report');

    const offset = reportOffsetMinutes();
    let csv: string;
    let parts: string[];
    let count = 0;

    if (type === 'sales') {
      const range = ruleGuard(() => resolveRange({ from, to, now: new Date(), offsetMin: offset, maxDays: MAX_DAYS }));
      const rows = await this.prisma.sale.findMany({
        where: {
          organizationId: me.orgId,
          soldAt: { gte: range.startUtc, lt: range.endUtc },
          status: { in: ['CONFIRMED', 'PAID'] }, // drafts and cancelled sales are not revenue
        },
        select: { reference: true, status: true, soldAt: true, customerName: true, total: true, feeAmount: true, netAmount: true },
        orderBy: { soldAt: 'asc' },
        take: MAX_ROWS + 1,
      });
      if (rows.length > MAX_ROWS) throw new BadRequestException(`More than ${MAX_ROWS} rows. Choose a shorter period.`);
      csv = toCsv(
        ['Reference', 'Status', 'Sold at (UTC)', 'Customer', 'Total', 'Platform fee', 'Net'],
        rows.map((r) => [r.reference, r.status, r.soldAt, r.customerName ?? 'Walk-in', r.total.toFixed(2), r.feeAmount.toFixed(2), r.netAmount.toFixed(2)]),
      );
      count = rows.length;
      parts = ['sales', range.from, range.to];
    } else if (type === 'expenses') {
      const range = ruleGuard(() => resolveRange({ from, to, now: new Date(), offsetMin: offset, maxDays: MAX_DAYS }));
      const rows = await this.prisma.expense.findMany({
        where: { organizationId: me.orgId, spentAt: { gte: range.startUtc, lt: range.endUtc } },
        select: { spentAt: true, category: true, description: true, amount: true, status: true, reference: true },
        orderBy: { spentAt: 'asc' },
        take: MAX_ROWS + 1,
      });
      if (rows.length > MAX_ROWS) throw new BadRequestException(`More than ${MAX_ROWS} rows. Choose a shorter period.`);
      csv = toCsv(
        ['Spent at (UTC)', 'Category', 'Description', 'Amount', 'Status', 'Reference'],
        rows.map((r) => [r.spentAt, r.category, r.description, r.amount.toFixed(2), r.status, r.reference ?? '']),
      );
      count = rows.length;
      parts = ['expenses', range.from, range.to];
    } else {
      // Stock is a current snapshot, so no date range applies.
      const rows = await this.prisma.product.findMany({
        where: { organizationId: me.orgId },
        select: { sku: true, name: true, quantity: true, reorderLevel: true, unitPrice: true },
        orderBy: { name: 'asc' },
        take: MAX_ROWS + 1,
      });
      if (rows.length > MAX_ROWS) throw new BadRequestException(`More than ${MAX_ROWS} products.`);
      csv = toCsv(
        ['SKU', 'Name', 'Quantity', 'Reorder level', 'Low stock', 'Unit price'],
        rows.map((r) => [r.sku, r.name, r.quantity, r.reorderLevel, r.quantity <= r.reorderLevel ? 'YES' : 'no', r.unitPrice.toFixed(2)]),
      );
      count = rows.length;
      parts = ['inventory', new Date().toISOString().slice(0, 10)];
    }

    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'report.export',
      entityType: 'Report',
      details: { type, rows: count },
    });

    const filename = safeFilename(parts);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
