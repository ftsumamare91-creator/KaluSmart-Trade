import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Category } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { buildCategoryTree } from './category-tree';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class CategoryQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(80) nameAm!: string;
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) nameOm?: string;
  @IsOptional() @IsString() @MaxLength(80) nameTi?: string;
  @IsString() @MaxLength(60) @Matches(SLUG, { message: 'slug must be lowercase letters, digits and dashes' }) slug!: string;
  @IsOptional() @IsString() @MaxLength(40) parentId?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) nameAm?: string;
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) nameOm?: string;
  @IsOptional() @IsString() @MaxLength(80) nameTi?: string;
  @IsOptional() @IsString() @MaxLength(60) @Matches(SLUG, { message: 'slug must be lowercase letters, digits and dashes' }) slug?: string;
  /** null moves the category to the top level */
  @IsOptional() @IsString() @MaxLength(40) parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

@Controller('categories')
export class CategoriesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermission('categories:read')
  list(@Me() me: CurrentUser, @Query() q: CategoryQuery) {
    return this.prisma.category.findMany({
      where: { organizationId: me.orgId, ...(q.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { nameAm: 'asc' }],
    });
  }

  /** Declared before ':id' so that 'tree' is not treated as an id. */
  @Get('tree') @RequirePermission('categories:read')
  async tree(@Me() me: CurrentUser, @Query() q: CategoryQuery) {
    const rows = await this.prisma.category.findMany({
      where: { organizationId: me.orgId },
      orderBy: [{ sortOrder: 'asc' }, { nameAm: 'asc' }],
    });
    return buildCategoryTree(rows, q.includeInactive === true);
  }

  @Get(':id') @RequirePermission('categories:read')
  async one(@Me() me: CurrentUser, @Param('id') id: string) {
    const cat = await this.findOrFail(me.orgId, id);
    return { ...cat, path: await this.breadcrumb(me.orgId, cat) };
  }

  @Post() @RequirePermission('categories:write')
  async create(@Me() me: CurrentUser, @Body() d: CreateCategoryDto) {
    const parentId = d.parentId ?? null;
    if (parentId) await this.assertParentUsable(me.orgId, parentId, null);
    await this.assertSlugFree(me.orgId, parentId, d.slug, null);

    const c = await this.prisma.category.create({
      data: {
        organizationId: me.orgId,
        parentId,
        slug: d.slug,
        nameAm: d.nameAm,
        nameEn: d.nameEn ?? null,
        nameOm: d.nameOm ?? null,
        nameTi: d.nameTi ?? null,
        description: d.description ?? null,
        sortOrder: d.sortOrder ?? 0,
      },
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'category.create', entityType: 'Category', entityId: c.id });
    return c;
  }

  @Patch(':id') @RequirePermission('categories:write')
  async update(@Me() me: CurrentUser, @Param('id') id: string, @Body() d: UpdateCategoryDto) {
    const cur = await this.findOrFail(me.orgId, id);
    const parentId = d.parentId === undefined ? cur.parentId : d.parentId;
    const slug = d.slug ?? cur.slug;

    if (parentId) await this.assertParentUsable(me.orgId, parentId, id);
    if (parentId !== cur.parentId || slug !== cur.slug) await this.assertSlugFree(me.orgId, parentId, slug, id);

    const c = await this.prisma.category.update({
      where: { id },
      data: {
        parentId,
        slug,
        nameAm: d.nameAm,
        nameEn: d.nameEn,
        nameOm: d.nameOm,
        nameTi: d.nameTi,
        description: d.description,
        sortOrder: d.sortOrder,
      },
    });
    await this.audit.record({ organizationId: me.orgId, userId: me.id, action: 'category.update', entityType: 'Category', entityId: id });
    return c;
  }

  /** Disabling hides the category and its subtree from the tree; products keep their link. */
  @Post(':id/disable') @RequirePermission('categories:write')
  disable(@Me() me: CurrentUser, @Param('id') id: string) {
    return this.setActive(me, id, false);
  }

  @Post(':id/enable') @RequirePermission('categories:write')
  enable(@Me() me: CurrentUser, @Param('id') id: string) {
    return this.setActive(me, id, true);
  }

  private async setActive(me: CurrentUser, id: string, isActive: boolean) {
    const cur = await this.findOrFail(me.orgId, id);
    if (cur.isActive === isActive) return cur;

    if (isActive && cur.parentId) {
      const parent = await this.prisma.category.findFirst({ where: { id: cur.parentId, organizationId: me.orgId } });
      if (parent && !parent.isActive) throw new BadRequestException('Enable the parent category first');
    }

    const c = await this.prisma.category.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: isActive ? 'category.enable' : 'category.disable',
      entityType: 'Category',
      entityId: id,
    });
    return c;
  }

  private async findOrFail(orgId: string, id: string): Promise<Category> {
    const c = await this.prisma.category.findFirst({ where: { id, organizationId: orgId } });
    if (!c) throw new NotFoundException('Category not found');
    return c;
  }

  /** The parent must exist in this organization, be enabled, and (on move) must not be a descendant of the category itself. */
  private async assertParentUsable(orgId: string, parentId: string, selfId: string | null) {
    if (selfId && parentId === selfId) throw new BadRequestException('A category cannot be its own parent');

    const first = await this.prisma.category.findFirst({ where: { id: parentId, organizationId: orgId } });
    if (!first) throw new BadRequestException('Parent category not found');
    if (!first.isActive) throw new BadRequestException('Parent category is disabled');

    if (selfId) {
      let ancestor: Category | null = first;
      while (ancestor) {
        if (ancestor.id === selfId) throw new BadRequestException('A category cannot be moved under its own subcategory');
        ancestor = ancestor.parentId
          ? await this.prisma.category.findFirst({ where: { id: ancestor.parentId, organizationId: orgId } })
          : null;
      }
    }
  }

  private async assertSlugFree(orgId: string, parentId: string | null, slug: string, exceptId: string | null) {
    const clash = await this.prisma.category.findFirst({
      where: { organizationId: orgId, parentId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (clash) throw new BadRequestException('A category with this slug already exists under the same parent');
  }

  private async breadcrumb(orgId: string, cat: Category) {
    const chain: Category[] = [cat];
    let parentId = cat.parentId;
    while (parentId && chain.length < 20) {
      const p = await this.prisma.category.findFirst({ where: { id: parentId, organizationId: orgId } });
      if (!p) break;
      chain.unshift(p);
      parentId = p.parentId;
    }
    return chain.map((c) => ({ id: c.id, slug: c.slug, nameAm: c.nameAm, nameEn: c.nameEn }));
  }
}
