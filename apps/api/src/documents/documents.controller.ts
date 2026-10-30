import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join, resolve, sep } from 'path';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { RateLimiter } from '../common/rate-limit';
import { normaliseQuery, searchDocuments } from './document-search';
import {
  ANALYZABLE,
  DOC_MAX_BYTES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  LINKED_TYPES,
  SAFE_ID,
  canTransition,
  detectDocument,
  parseModelJson,
  safeTitle,
  sanitizeExtraction,
  storageKeyFor,
  DocumentStatus,
  LinkedType,
} from './document-rules';

interface UploadedDoc {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
}

/** Each analysis is a paid model call: 10 per user per minute. */
const analyzeLimiter = new RateLimiter(10, 60_000);
/** A run stuck in PROCESSING longer than this (for example after a crash) may be claimed again. */
const STALE_PROCESSING_MS = 5 * 60_000;

const PUBLIC_SELECT = {
  id: true,
  title: true,
  mimeType: true,
  category: true,
  status: true,
  sizeBytes: true,
  linkedType: true,
  linkedId: true,
  extractedFields: true,
  processingError: true,
  reviewDecision: true,
  reviewedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function uploadRoot(): string {
  return resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'));
}

/** Last check before touching the disk: the resolved path must stay inside the upload root. */
function safePath(storageKey: string): string {
  const root = uploadRoot();
  const full = resolve(root, storageKey);
  if (!full.startsWith(root + sep)) throw new BadRequestException('Invalid storage location');
  return full;
}

@Controller('documents')
export class DocumentsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * Upload one business document (PDF, PNG, JPEG, WebP, DOCX, XLSX, CSV, TXT, MD; 10 MB).
   * Multipart field "file"; optional fields: category, linkedType, linkedId.
   * Duplicates (same bytes in the same organization) return 409 with the existing document id.
   */
  @Post() @RequirePermission('documents:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOC_MAX_BYTES } }))
  async upload(
    @Me() me: CurrentUser,
    @UploadedFile() file: UploadedDoc | undefined,
    @Body() body: Record<string, string | undefined>,
  ) {
    if (!file || file.buffer.length === 0) throw new BadRequestException('No file uploaded');
    if (file.buffer.length > DOC_MAX_BYTES) throw new BadRequestException('File is too large (maximum 10 MB)');

    const detected = detectDocument(file.originalname ?? '', file.buffer);
    if (!detected) {
      throw new BadRequestException('Unsupported file. Use PDF, PNG, JPEG, WebP, DOCX, XLSX, CSV, TXT or MD, with matching content.');
    }

    const category = (body.category ?? 'OTHER').toUpperCase();
    if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestException('Unknown category');

    const linkedType = body.linkedType ? body.linkedType.toUpperCase() : null;
    const linkedId = body.linkedId ? body.linkedId : null;
    if ((linkedType && !linkedId) || (!linkedType && linkedId)) {
      throw new BadRequestException('linkedType and linkedId must be sent together');
    }
    if (linkedType) {
      if (!(LINKED_TYPES as readonly string[]).includes(linkedType)) throw new BadRequestException('Unknown linked record type');
      await this.linkedRecordOrThrow(me.orgId, linkedType as LinkedType, linkedId!);
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.businessDocument.findFirst({
      where: { organizationId: me.orgId, sha256 },
      select: { id: true },
    });
    if (existing) throw new ConflictException({ message: 'This file was already uploaded', existingId: existing.id });

    const id = randomUUID();
    const storageKey = storageKeyFor(me.orgId, id, detected.ext);
    const fullPath = safePath(storageKey);
    await mkdir(join(uploadRoot(), 'documents', me.orgId), { recursive: true });
    await writeFile(fullPath, file.buffer, { flag: 'wx' });

    try {
      const doc = await this.prisma.businessDocument.create({
        data: {
          id,
          organizationId: me.orgId,
          title: safeTitle(file.originalname ?? 'document'),
          mimeType: detected.mime,
          storageKey,
          category,
          sizeBytes: file.buffer.length,
          sha256,
          uploadedById: me.id,
          linkedType,
          linkedId,
        },
        select: PUBLIC_SELECT,
      });
      await this.audit.record({
        organizationId: me.orgId,
        userId: me.id,
        action: 'document.upload',
        entityType: 'BusinessDocument',
        entityId: id,
        details: { category, bytes: file.buffer.length, linkedType },
      });
      return doc;
    } catch (err) {
      await rm(fullPath, { force: true }); // no orphaned file when the record was not saved
      const code = (err as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException('This file was already uploaded');
      throw err;
    }
  }

  /** Paginated list of the organization's active (not archived) documents. */
  @Get() @RequirePermission('documents:read')
  async list(@Me() me: CurrentUser, @Query() q: Record<string, string | undefined>) {
    const page = Math.max(1, Math.min(1000, parseInt(q.page ?? '1', 10) || 1));
    const take = Math.max(1, Math.min(100, parseInt(q.take ?? '20', 10) || 20));
    const where: any = { organizationId: me.orgId, archivedAt: null };
    if (q.category) {
      const c = q.category.toUpperCase();
      if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(c)) throw new BadRequestException('Unknown category');
      where.category = c;
    }
    if (q.status) {
      const s = q.status.toUpperCase();
      if (!(DOCUMENT_STATUSES as readonly string[]).includes(s)) throw new BadRequestException('Unknown status');
      where.status = s;
    }
    if (q.q) where.title = { contains: q.q.slice(0, 100), mode: 'insensitive' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.businessDocument.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
      }),
      this.prisma.businessDocument.count({ where }),
    ]);
    return { items, total, page, pageSize: take };
  }

  /**
   * Keyword search in titles and extracted fields. Scans at most the 500 newest active documents of the caller's
   * organization, so the cost is bounded. Vector search is not part of this endpoint.
   */
  @Get('search') @RequirePermission('documents:read')
  async search(@Me() me: CurrentUser, @Query('q') rawQ: string | undefined) {
    const q = normaliseQuery(rawQ ?? '');
    if (!q) throw new BadRequestException('Enter 2 to 100 characters to search');
    const rows = await this.prisma.businessDocument.findMany({
      where: { organizationId: me.orgId, archivedAt: null },
      select: { id: true, title: true, category: true, status: true, extractedFields: true },
      orderBy: { createdAt: 'desc' },
      take: 501,
    });
    const truncated = rows.length > 500;
    const results = searchDocuments(rows.slice(0, 500) as any, q);
    return { query: q, results, scanned: Math.min(rows.length, 500), truncated };
  }

  @Get(':id') @RequirePermission('documents:read')
  async get(@Me() me: CurrentUser, @Param('id') id: string) {
    return this.docOrThrow(me.orgId, id, PUBLIC_SELECT);
  }

  /** Renames or re-categorises. The file itself is never replaced here. */
  @Patch(':id') @RequirePermission('documents:write')
  async update(@Me() me: CurrentUser, @Param('id') id: string, @Body() body: { title?: unknown; category?: unknown }) {
    const doc = await this.docOrThrow(me.orgId, id, { id: true, status: true });
    if (doc.status === 'PROCESSING') throw new ConflictException('This document is being processed');
    const data: { title?: string; category?: string } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) throw new BadRequestException('Title is required');
      data.title = safeTitle(body.title);
    }
    if (body.category !== undefined) {
      const c = String(body.category).toUpperCase();
      if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(c)) throw new BadRequestException('Unknown category');
      data.category = c;
    }
    const updated = await this.prisma.businessDocument.update({ where: { id }, data, select: PUBLIC_SELECT });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'document.update',
      entityType: 'BusinessDocument',
      entityId: id,
      details: { fields: Object.keys(data) },
    });
    return updated;
  }

  /** Streams the original file as an attachment. Only the owning organization can read it. */
  @Get(':id/download') @RequirePermission('documents:read')
  async download(@Me() me: CurrentUser, @Param('id') id: string) {
    const doc = await this.docOrThrow(me.orgId, id, { id: true, title: true, mimeType: true, storageKey: true });
    const path = safePath(doc.storageKey);
    await stat(path).catch(() => {
      throw new NotFoundException('The stored file is missing');
    });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'document.download',
      entityType: 'BusinessDocument',
      entityId: id,
    });
    return new StreamableFile(createReadStream(path), {
      type: doc.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
    });
  }

  /**
   * Runs OCR-style extraction through the AI service. The result is UNVERIFIED and goes to REVIEW_REQUIRED.
   * Nothing here creates a sale, expense, purchase or payment.
   */
  @Post(':id/analyze') @RequirePermission('documents:write')
  async analyze(@Me() me: CurrentUser, @Param('id') id: string) {
    analyzeLimiter.consume(me.id);
    const doc = await this.docOrThrow(me.orgId, id, { id: true, status: true, updatedAt: true, storageKey: true, mimeType: true, title: true });

    // Claim the document atomically so two requests cannot run the model twice.
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    const claimed = await this.prisma.businessDocument.updateMany({
      where: {
        id,
        organizationId: me.orgId,
        OR: [{ status: { in: ANALYZABLE } }, { status: 'PROCESSING', updatedAt: { lt: staleBefore } }],
      },
      data: { status: 'PROCESSING', processingError: null },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        doc.status === 'COMPLETED' ? 'This document is already confirmed' : 'This document is already being processed',
      );
    }

    const fail = async (message: string) => {
      await this.prisma.businessDocument.update({ where: { id }, data: { status: 'FAILED', processingError: message } });
      await this.audit.record({
        organizationId: me.orgId,
        userId: me.id,
        action: 'document.analyze.failed',
        entityType: 'BusinessDocument',
        entityId: id,
      });
      return { id, status: 'FAILED', processingError: message };
    };

    const token = process.env.AI_SERVICE_TOKEN;
    if (!token) return fail('The AI service is not configured');

    let base64: string;
    try {
      base64 = (await readFile(safePath(doc.storageKey))).toString('base64');
    } catch {
      return fail('The stored file could not be read');
    }

    const aiBase = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    let res: Response;
    try {
      res = await fetch(`${aiBase}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Token': token },
        body: JSON.stringify({
          attachment: { name: doc.title, mime: doc.mimeType, data_base64: base64 },
          language: 'auto',
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return fail('The AI service did not respond. Try again later.');
    }

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return fail(res.status === 503 ? 'The AI model is not configured' : 'Extraction failed. Try again later.');

    const fields = sanitizeExtraction(body.fields ?? parseModelJson(String(body.answer ?? '')));
    const updated = await this.prisma.businessDocument.update({
      where: { id },
      data: { status: 'REVIEW_REQUIRED', extractedFields: fields as any, processingError: null },
      select: PUBLIC_SELECT,
    });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'document.analyze',
      entityType: 'BusinessDocument',
      entityId: id,
    });
    return updated;
  }

  /**
   * Human review of the extraction. CONFIRM stores the reviewed fields (status COMPLETED) and REJECT marks it failed.
   * Neither creates a financial record; that still requires the normal sale/expense/purchase workflow.
   */
  @Post(':id/review') @RequirePermission('documents:review')
  async review(
    @Me() me: CurrentUser,
    @Param('id') id: string,
    @Body() body: { decision?: unknown; fields?: unknown },
  ) {
    const doc = await this.docOrThrow(me.orgId, id, { id: true, status: true, extractedFields: true });
    if (doc.status !== 'REVIEW_REQUIRED') throw new ConflictException('Only documents awaiting review can be reviewed');

    const decision = String(body.decision ?? '').toUpperCase();
    if (decision !== 'CONFIRM' && decision !== 'REJECT') throw new BadRequestException('decision must be CONFIRM or REJECT');

    const target: DocumentStatus = decision === 'CONFIRM' ? 'COMPLETED' : 'FAILED';
    if (!canTransition('REVIEW_REQUIRED', target)) throw new ConflictException('Invalid status change');

    const reviewed = {
      status: target,
      reviewDecision: decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
      reviewedById: me.id,
      reviewedAt: new Date(),
      processingError: decision === 'REJECT' ? 'Rejected by a reviewer' : null,
      ...(decision === 'CONFIRM'
        ? { extractedFields: sanitizeExtraction(body.fields ?? doc.extractedFields) as any }
        : {}),
    };
    // Conditional on the status still being REVIEW_REQUIRED, so two reviewers cannot both decide.
    const result = await this.prisma.businessDocument.updateMany({
      where: { id, organizationId: me.orgId, status: 'REVIEW_REQUIRED' },
      data: reviewed,
    });
    if (result.count === 0) throw new ConflictException('This document was already reviewed');

    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: `document.review.${decision.toLowerCase()}`,
      entityType: 'BusinessDocument',
      entityId: id,
    });
    return this.docOrThrow(me.orgId, id, PUBLIC_SELECT);
  }

  /** Archive only. Files and history are kept for audit and retention; nothing is hard-deleted here. */
  @Delete(':id') @RequirePermission('documents:delete')
  async archive(@Me() me: CurrentUser, @Param('id') id: string) {
    const doc = await this.docOrThrow(me.orgId, id, { id: true, status: true });
    if (doc.status === 'PROCESSING') throw new ConflictException('This document is being processed');
    const archived = await this.prisma.businessDocument.update({
      where: { id },
      data: { archivedAt: new Date() },
      select: PUBLIC_SELECT,
    });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'document.archive',
      entityType: 'BusinessDocument',
      entityId: id,
    });
    return archived;
  }

  private async docOrThrow<S extends Record<string, boolean>>(orgId: string, id: string, select: S): Promise<any> {
    if (!SAFE_ID.test(id)) throw new NotFoundException('Document not found');
    const doc = await this.prisma.businessDocument.findFirst({
      where: { id, organizationId: orgId },
      select: select as any,
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  private async linkedRecordOrThrow(orgId: string, type: LinkedType, id: string): Promise<void> {
    if (!SAFE_ID.test(id)) throw new BadRequestException('Invalid linked record id');
    const where = { id, organizationId: orgId };
    const found =
      type === 'SALE' ? await this.prisma.sale.findFirst({ where, select: { id: true } })
      : type === 'EXPENSE' ? await this.prisma.expense.findFirst({ where, select: { id: true } })
      : type === 'PURCHASE' ? await this.prisma.purchase.findFirst({ where, select: { id: true } })
      : type === 'SUPPLIER' ? await this.prisma.supplier.findFirst({ where, select: { id: true } })
      : await this.prisma.customer.findFirst({ where, select: { id: true } });
    if (!found) throw new NotFoundException('Linked record not found');
  }
}
