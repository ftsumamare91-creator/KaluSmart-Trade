import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { can } from '../common/permissions';

@Controller('summary')
export class SummaryController {
  constructor(private prisma: PrismaService) {}

  /** Figures come only from this organization's stored records. "Net" is sales minus recorded expenses, not audited profit. */
  @Get() @RequirePermission('sales:read')
  async summary(@Me() me: CurrentUser) {
    const since = new Date(Date.now() - 30 * 86400_000);
    const org = me.orgId;
    const canSeeExpenses = can(me.role, 'expenses:read');
    const [customers, products, sales, expenses, lowStock, monthlySales] = await Promise.all([
      this.prisma.customer.count({ where: { organizationId: org } }),
      this.prisma.product.count({ where: { organizationId: org } }),
      this.prisma.sale.aggregate({ where: { organizationId: org, soldAt: { gte: since }, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
      this.prisma.expense.aggregate({ where: { organizationId: org, spentAt: { gte: since } }, _sum: { amount: true } }),
      this.prisma.$queryRaw<{ id: string; name: string; quantity: number; reorderLevel: number }[]>`
        SELECT id, name, quantity, "reorderLevel" FROM "Product"
        WHERE "organizationId" = ${org} AND quantity <= "reorderLevel" ORDER BY quantity ASC LIMIT 20`,
      this.prisma.sale.count({ where: { organizationId: org, soldAt: { gte: since } } }),
    ]);
    const salesTotal = Number(sales._sum.total ?? 0);
    const expenseTotal = Number(expenses._sum.amount ?? 0);
    return {
      period: { from: since.toISOString(), to: new Date().toISOString(), days: 30 },
      customers,
      products,
      sales: { count: sales._count, total: salesTotal },
      expenses: canSeeExpenses ? { total: expenseTotal } : null,
      salesMinusExpenses: canSeeExpenses ? salesTotal - expenseTotal : null,
      lowStock,
      recentSalesCount: monthlySales,
    };
  }
}
