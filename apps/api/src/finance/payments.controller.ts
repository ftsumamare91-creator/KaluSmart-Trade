import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { fromCents, requiresReference, toCents } from './money';
import {
  ProviderDecision,
  createAdapters,
  decideProviderOutcome,
  isProviderMethod,
  lookupWithDeadline,
  PaymentProviderAdapter,
  ProviderMethod,
  providerTimeoutMs,
  referenceProblem,
} from './payment-verification';

class RecordPaymentDto {
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'amount must be a positive number with up to 2 decimals' }) amount!: string;
  /** Telebirr transaction number or bank transfer reference, printed on the receipt. */
  @IsOptional() @IsString() @MaxLength(80) providerReference?: string;
  @IsOptional() @IsString() @MaxLength(20) payerPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(120) payerName?: string;
}

type PaymentRow = { status: string; amount: Prisma.Decimal };

/**
 * Money in integer cents. Only CONFIRMED payments are funds received. PENDING payments are reserved
 * against the balance so two pending payments cannot promise more than the sale total. REJECTED and FAILED ones are ignored.
 */
export function summarize(total: Prisma.Decimal, payments: PaymentRow[]) {
  const totalCents = toCents(total.toFixed(2));
  let confirmedCents = 0n;
  let pendingCents = 0n;
  for (const p of payments) {
    const cents = toCents(p.amount.toFixed(2));
    if (p.status === 'CONFIRMED') confirmedCents += cents;
    else if (p.status === 'PENDING') pendingCents += cents;
  }
  const balanceCents = confirmedCents >= totalCents ? 0n : totalCents - confirmedCents;
  return {
    totalCents,
    confirmedCents,
    pendingCents,
    balanceCents,
    view: {
      total: fromCents(totalCents),
      confirmed: fromCents(confirmedCents),
      pending: fromCents(pendingCents),
      balanceDue: fromCents(balanceCents),
    },
  };
}

/**
 * Payments follow a review flow. An employee records a payment (PENDING). Two routes then decide it:
 *  - Provider check (`verify-provider`): a trusted adapter confirms the amount and currency. Result is PROVIDER.
 *  - Manual review (`confirm` / `reject`): an accountant or admin checks the receipt. Result is MANUAL.
 * A sale becomes PAID once confirmed payments cover its total. Every try is written to PaymentVerificationAttempt.
 * Customers have no login, so they cannot verify anything. Only the payments:confirm permission can decide a payment.
 */
@Controller()
export class PaymentsController {
  /** Provider adapters. Telebirr and bank stay UNAVAILABLE until real credentials and API documentation exist. */
  adapters: Record<ProviderMethod, PaymentProviderAdapter> = createAdapters();

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('sales/:saleId/payments') @RequirePermission('sales:read')
  async list(@Me() me: CurrentUser, @Param('saleId') saleId: string) {
    await this.findSale(me.orgId, saleId);
    return this.prisma.payment.findMany({ where: { organizationId: me.orgId, saleId }, orderBy: { createdAt: 'asc' } });
  }

  @Get('sales/:saleId/balance') @RequirePermission('sales:read')
  async balance(@Me() me: CurrentUser, @Param('saleId') saleId: string) {
    const sale = await this.findSale(me.orgId, saleId);
    const payments = await this.prisma.payment.findMany({ where: { organizationId: me.orgId, saleId }, select: { status: true, amount: true } });
    return summarize(sale.total, payments).view;
  }

  @Get('payments/:id/verification-attempts') @RequirePermission('payments:confirm')
  async attempts(@Me() me: CurrentUser, @Param('id') id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, organizationId: me.orgId }, select: { id: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.prisma.paymentVerificationAttempt.findMany({
      where: { organizationId: me.orgId, paymentId: id },
      orderBy: { startedAt: 'asc' },
      select: { id: true, kind: true, outcome: true, errorCode: true, requestedById: true, startedAt: true, finishedAt: true },
    });
  }

  @Post('sales/:saleId/payments') @RequirePermission('payments:write')
  async record(@Me() me: CurrentUser, @Param('saleId') saleId: string, @Body() d: RecordPaymentDto) {
    const amountCents = toCents(d.amount);
    if (amountCents <= 0n) throw new BadRequestException('Amount must be greater than zero');
    if (requiresReference(d.method)) {
      const problem = referenceProblem(d.providerReference);
      if (problem === 'REFERENCE_REQUIRED') {
        throw new BadRequestException('A receipt or transaction reference is required for this payment method');
      }
      if (problem === 'REFERENCE_INVALID') {
        throw new BadRequestException('The receipt reference must be 4 to 80 letters, digits, dashes, underscores or slashes');
      }
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      // Lock the sale so two payments submitted together see each other's amounts.
      await tx.$queryRaw`SELECT id FROM \"Sale\" WHERE id = ${saleId} AND \"organizationId\" = ${me.orgId} FOR UPDATE`;
      const sale = await tx.sale.findFirst({ where: { id: saleId, organizationId: me.orgId } });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status === 'CANCELLED' || sale.status === 'PAID') throw new BadRequestException(`Sale is already ${sale.status}`);

      const existing = await tx.payment.findMany({ where: { organizationId: me.orgId, saleId }, select: { status: true, amount: true } });
      const s = summarize(sale.total, existing);
      if (s.confirmedCents + s.pendingCents + amountCents > s.totalCents) {
        const remaining = fromCents(s.totalCents - s.confirmedCents - s.pendingCents);
        throw new BadRequestException(`This amount is more than the balance due. Remaining after pending payments: ${remaining}`);
      }

      try {
        return await tx.payment.create({
          data: {
            organizationId: me.orgId,
            saleId,
            method: d.method,
            amount: new Prisma.Decimal(d.amount),
            providerReference: d.providerReference?.trim() || null,
            payerPhone: d.payerPhone,
            bankName: d.bankName,
            payerName: d.payerName,
            recordedById: me.id,
          },
        });
      } catch (e) {
        // The same receipt must not be recorded twice (the unique index covers organization, method and reference).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new BadRequestException('This receipt reference has already been recorded');
        }
        throw e;
      }
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'payment.record', entityType: 'Payment', entityId: payment.id, details: { saleId, method: d.method, amount: d.amount } });
    return payment;
  }

  /**
   * Asks the payment provider whether the recorded reference is a real transaction for this exact amount.
   * Only a VERIFIED answer from the adapter can confirm a payment. Everything else leaves a decision trail and,
   * for inconclusive answers, leaves the payment PENDING for manual review.
   */
  @Post('payments/:id/verify-provider') @RequirePermission('payments:confirm')
  async verifyWithProvider(@Me() me: CurrentUser, @Param('id') id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, organizationId: me.orgId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!isProviderMethod(payment.method)) {
      throw new BadRequestException('Cash payments are confirmed by hand. They have no provider to check.');
    }
    // Idempotent: a payment already verified by the provider returns its stored result, with no new lookup.
    if (payment.status === 'CONFIRMED' && payment.verificationMethod === 'PROVIDER') {
      return { payment, outcome: 'VERIFIED', errorCode: null };
    }
    if (payment.status !== 'PENDING') throw new BadRequestException('Only pending payments can be checked with the provider');
    if (!payment.providerReference) throw new BadRequestException('This payment has no reference to check');

    const adapter = this.adapters[payment.method];
    const startedAt = new Date();
    const outcome = await lookupWithDeadline(adapter, payment.providerReference, providerTimeoutMs());
    const first = decideProviderOutcome(payment.amount.toFixed(2), outcome);

    let result: { payment: any; decision: ProviderDecision; saleId: string };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const row = await tx.payment.findFirst({ where: { id, organizationId: me.orgId } });
        if (!row) throw new NotFoundException('Payment not found');
        await tx.$queryRaw`SELECT id FROM \"Sale\" WHERE id = ${row.saleId} FOR UPDATE`;
        // Re-read under the sale lock: a concurrent confirm or check may have decided it already.
        const current = await tx.payment.findFirst({ where: { id, organizationId: me.orgId } });
        if (!current || current.status !== 'PENDING') throw new BadRequestException('This payment was already decided. Refresh and try again.');

        const sale = await tx.sale.findFirstOrThrow({ where: { id: current.saleId, organizationId: me.orgId } });
        let decision: ProviderDecision = first;

        if (decision.action === 'CONFIRM') {
          const duplicate = await tx.payment.findFirst({
            where: { organizationId: me.orgId, method: current.method, providerTransactionId: decision.transactionId, NOT: { id } },
            select: { id: true },
          });
          if (duplicate) decision = { action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'DUPLICATE_TRANSACTION' };
        }
        if (decision.action === 'CONFIRM') {
          if (sale.status === 'CANCELLED') {
            decision = { action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'SALE_CANCELLED' };
          } else {
            const all = await tx.payment.findMany({ where: { organizationId: me.orgId, saleId: sale.id }, select: { status: true, amount: true } });
            const s = summarize(sale.total, all);
            if (s.confirmedCents + toCents(current.amount.toFixed(2)) > s.totalCents) {
              decision = { action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'OVER_TOTAL' };
            }
          }
        }

        let updated = current;
        if (decision.action === 'CONFIRM') {
          updated = await tx.payment.update({
            where: { id },
            data: {
              status: 'CONFIRMED',
              verificationMethod: 'PROVIDER',
              providerTransactionId: decision.transactionId,
              verifiedAmount: new Prisma.Decimal(decision.verifiedAmount),
              verifiedCurrency: decision.verifiedCurrency,
              confirmedAt: new Date(),
            },
          });
          const newConfirmed = summarize(sale.total, await tx.payment.findMany({ where: { organizationId: me.orgId, saleId: sale.id }, select: { status: true, amount: true } })).confirmedCents;
          if (sale.status === 'CONFIRMED' && newConfirmed >= toCents(sale.total.toFixed(2))) {
            await tx.sale.update({ where: { id: sale.id }, data: { status: 'PAID' } });
          }
        } else if (decision.action === 'FAIL') {
          updated = await tx.payment.update({ where: { id }, data: { status: 'FAILED', confirmedAt: new Date() } });
        }

        await tx.paymentVerificationAttempt.create({
          data: {
            organizationId: me.orgId,
            paymentId: id,
            kind: 'PROVIDER_CHECK',
            outcome: decision.attemptOutcome,
            errorCode: decision.action === 'CONFIRM' ? null : decision.errorCode,
            requestedById: me.id,
            startedAt,
            finishedAt: new Date(),
          },
        });
        return { payment: updated, decision, saleId: sale.id };
      });
    } catch (e) {
      // A concurrent request already credited this provider transaction to another payment.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && first.action === 'CONFIRM') {
        await this.prisma.paymentVerificationAttempt.create({
          data: { organizationId: me.orgId, paymentId: id, kind: 'PROVIDER_CHECK', outcome: 'FAILED', errorCode: 'DUPLICATE_TRANSACTION', requestedById: me.id, startedAt, finishedAt: new Date() },
        });
        throw new ConflictException('This provider transaction is already recorded against another payment');
      }
      throw e;
    }

    const errorCode = result.decision.action === 'CONFIRM' ? null : result.decision.errorCode;
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'payment.verify_provider',
      entityType: 'Payment',
      entityId: id,
      details: { saleId: result.saleId, method: payment.method, outcome: result.decision.attemptOutcome, errorCode },
    });
    return { payment: result.payment, outcome: result.decision.attemptOutcome, errorCode };
  }

  /** Manual review: an accountant or admin checked the receipt. Recorded as MANUAL, never as provider verification. */
  @Post('payments/:id/confirm') @RequirePermission('payments:confirm')
  async confirm(@Me() me: CurrentUser, @Param('id') id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.payment.findFirst({ where: { id, organizationId: me.orgId } });
      if (!pending) throw new NotFoundException('Payment not found');
      await tx.$queryRaw`SELECT id FROM \"Sale\" WHERE id = ${pending.saleId} FOR UPDATE`;
      const payment = await tx.payment.findFirst({ where: { id, organizationId: me.orgId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== 'PENDING') throw new BadRequestException('Only pending payments can be confirmed');

      const sale = await tx.sale.findFirstOrThrow({ where: { id: pending.saleId, organizationId: me.orgId } });
      if (sale.status === 'CANCELLED') throw new BadRequestException('A cancelled sale cannot take payments');
      const all = await tx.payment.findMany({ where: { organizationId: me.orgId, saleId: sale.id }, select: { status: true, amount: true } });
      const s = summarize(sale.total, all);
      const amountCents = toCents(payment.amount.toFixed(2));
      const newConfirmed = s.confirmedCents + amountCents;
      if (newConfirmed > s.totalCents) {
        throw new BadRequestException('Confirming this payment would be more than the sale total');
      }

      const decidedAt = new Date();
      const updated = await tx.payment.update({
        where: { id },
        data: { status: 'CONFIRMED', verificationMethod: 'MANUAL', confirmedById: me.id, confirmedAt: decidedAt },
      });
      await tx.paymentVerificationAttempt.create({
        data: { organizationId: me.orgId, paymentId: id, kind: 'MANUAL_REVIEW', outcome: 'VERIFIED', requestedById: me.id, startedAt: decidedAt, finishedAt: decidedAt },
      });
      if (sale.status === 'CONFIRMED' && newConfirmed >= s.totalCents) {
        await tx.sale.update({ where: { id: sale.id }, data: { status: 'PAID' } });
      }
      return { updated, confirmed: fromCents(newConfirmed), saleId: sale.id };
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'payment.confirm', entityType: 'Payment', entityId: id, details: { saleId: result.saleId, verificationMethod: 'MANUAL', confirmedTotal: result.confirmed } });
    return result.updated;
  }

  @Post('payments/:id/reject') @RequirePermission('payments:confirm')
  async reject(@Me() me: CurrentUser, @Param('id') id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, organizationId: me.orgId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'PENDING') throw new BadRequestException('Only pending payments can be rejected');
    const decidedAt = new Date();
    // updateMany with a status guard means a payment decided by someone else cannot be overwritten.
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id, organizationId: me.orgId, status: 'PENDING' },
        data: { status: 'REJECTED', verificationMethod: null, confirmedById: me.id, confirmedAt: decidedAt },
      });
      if (changed.count !== 1) throw new BadRequestException('Only pending payments can be rejected');
      await tx.paymentVerificationAttempt.create({
        data: { organizationId: me.orgId, paymentId: id, kind: 'MANUAL_REVIEW', outcome: 'REJECTED', requestedById: me.id, startedAt: decidedAt, finishedAt: decidedAt },
      });
      return tx.payment.findFirstOrThrow({ where: { id, organizationId: me.orgId } });
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'payment.reject', entityType: 'Payment', entityId: id, details: { saleId: payment.saleId, verificationMethod: 'MANUAL' } });
    return updated;
  }

  private async findSale(orgId: string, saleId: string) {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, organizationId: orgId } });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }
}
