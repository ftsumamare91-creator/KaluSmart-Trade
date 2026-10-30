import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { ListQuery, take } from '../common/dto';
import { AuditService } from '../audit/audit.service';

class CreateProductDto {
  @IsString() @MinLength(1) @MaxLength(40) sku!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) quantity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderLevel?: number;
  /** Must be a subcategory (a category with no active children). */
  @IsOptional() @IsString() @MaxLength(40) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) model3dUrl?: string;
  @IsOptional() @IsString() @MaxLength(160) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(300) manufacturerAddress?: string;
  @IsOptional() @IsString() @MaxLength(60) qualityGrade?: string;
  @IsOptional() @IsDateString() productionDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

/** Stock is not editable here: use POST /products/:id/adjust. */
class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) sku?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsString() @MaxLength(40) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) model3dUrl?: string;
  @IsOptional() @IsString() @MaxLength(160) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(300) manufacturerAddress?: string;
  @IsOptional() @IsString() @MaxLength(60) qualityGrade?: string;
  @IsOptional() @IsDateString() productionDate?: string | null;
  @IsOptional() @IsDateString() expiryDate?: string | null;
}

class AdjustDto {
  @Type(() => Number) @IsInt() @Min(-10_000_000) @Max(10_000_000) delta!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class ProductListQuery extends ListQuery {
  @IsOptional() @IsString() @MaxLength(40) categoryId?: string;
}

const CATEGORY_SELECT = { select: { id: true, slug: true, nameAm: true, nameEn: true, nameOm: true, nameTi: true } } as const;

@Controller('products')
export class ProductsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('products:read')
  list(@Me() me: CurrentUser, @Query() q: ProductListQuery) {
    return this.prisma.product.findMany({
      where: {
        organizationId: me.orgId,
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }] } : {}),
      },
      include: { category: CATEGORY_SELECT },
      orderBy: { name: 'asc' },
      take: take(q),
    });
  }

  @Post() @RequirePermission('products:write')
  async create(@Me() me: CurrentUser, @Body() d: CreateProductDto) {
    if (d.categoryId) await this.assertLeafCategory(me.orgId, d.categoryId);
    const productionDate = d.productionDate ? new Date(d.productionDate) : null;
    const expiryDate = d.expiryDate ? new Date(d.expiryDate) : null;
    this.assertDates(productionDate, expiryDate);

    const p = await this.prisma.product.create({
      data: {
        organizationId: me.orgId,
        sku: d.sku,
        name: d.name,
        description: d.description,
        unitPrice: d.unitPrice,
        quantity: d.quantity,
        reorderLevel: d.reorderLevel,
        categoryId: d.categoryId ?? null,
        imageUrl: d.imageUrl,
        model3dUrl: d.model3dUrl,
        manufacturer: d.manufacturer,
        manufacturerAddress: d.manufacturerAddress,
        qualityGrade: d.qualityGrade,
        productionDate,
        expiryDate,
      },
      include: { category: CATEGORY_SELECT },
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'product.create', entityType: 'Product', entityId: p.id });
    return p;
  }

  @Patch(':id') @RequirePermission('products:write')
  async update(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: UpdateProductDto) {
    const cur = await this.prisma.product.findFirst({ where: { id, organizationId: me.orgId } });
    if (!cur) throw new NotFoundException();
    if (d.categoryId) await this.assertLeafCategory(me.orgId, d.categoryId);

    const productionDate = d.productionDate === undefined ? cur.productionDate : d.productionDate ? new Date(d.productionDate) : null;
    const expiryDate = d.expiryDate === undefined ? cur.expiryDate : d.expiryDate ? new Date(d.expiryDate) : null;
    this.assertDates(productionDate, expiryDate);

    const r = await this.prisma.product.updateMany({
      where: { id, organizationId: me.orgId },
      data: {
        sku: d.sku,
        name: d.name,
        description: d.description,
        unitPrice: d.unitPrice,
        reorderLevel: d.reorderLevel,
        categoryId: d.categoryId,
        imageUrl: d.imageUrl,
        model3dUrl: d.model3dUrl,
        manufacturer: d.manufacturer,
        manufacturerAddress: d.manufacturerAddress,
        qualityGrade: d.qualityGrade,
        productionDate,
        expiryDate,
      },
    });
    if (!r.count) throw new NotFoundException();
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'product.update', entityType: 'Product', entityId: id });
    return this.prisma.product.findFirst({ where: { id, organizationId: me.orgId }, include: { category: CATEGORY_SELECT } });
  }

  /** Atomic stock change: the guarded UPDATE refuses to take stock below zero. */
  @Post(':id/adjust') @RequirePermission('products:write')
  async adjust(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: AdjustDto) {
    if (d.delta === 0) throw new BadRequestException('Change must not be zero');
    // The change and its StockMovement row are written in one transaction.
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ quantity: number }[]>`
        UPDATE "Product" SET quantity = quantity + ${d.delta}, "updatedAt" = now()
        WHERE id = ${id} AND "organizationId" = ${me.orgId} AND quantity + ${d.delta} >= 0 RETURNING quantity`;
      if (!rows.length) throw new BadRequestException('Product not found or stock would go below zero');
      await tx.stockMovement.create({
        data: { organizationId: me.orgId, productId: id, delta: d.delta, quantityAfter: rows[0].quantity, reason: 'ADJUSTMENT', note: d.reason?.slice(0, 200), createdById: me.id },
      });
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'stock.adjust', entityType: 'Product', entityId: id, details: { delta: d.delta, reason: d.reason } });
    return this.prisma.product.findFirst({ where: { id, organizationId: me.orgId }, include: { category: CATEGORY_SELECT } });
  }

  /** Products belong to the most specific level: a category that still has active children is rejected. */
  private async assertLeafCategory(orgId: string, categoryId: string) {
    const c = await this.prisma.category.findFirst({ where: { id: categoryId, organizationId: orgId } });
    if (!c) throw new BadRequestException('Category not found');
    if (!c.isActive) throw new BadRequestException('Category is disabled');
    const children = await this.prisma.category.count({ where: { organizationId: orgId, parentId: categoryId, isActive: true } });
    if (children > 0) throw new BadRequestException('Choose a more specific subcategory for this product');
  }

  private assertDates(production: Date | null, expiry: Date | null) {
    if (production && expiry && expiry.getTime() <= production.getTime()) {
      throw new BadRequestException('Expiry date must be after the production date');
    }
  }
}
