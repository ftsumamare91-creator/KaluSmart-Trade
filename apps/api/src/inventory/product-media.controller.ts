import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../common/prisma.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { MAX_UPLOAD_BYTES, MEDIA_LIMITS, MediaKind, allowedFor, detectMedia, mimeForExt, parseKind } from '../uploads/media';

/** The shape multer gives us with memory storage (kept local so no extra @types package is needed). */
interface UploadedMedia {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Files live outside the web root and are only ever streamed back through the authenticated route below. */
function uploadRoot(): string {
  return resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'));
}

@Controller('products')
export class ProductMediaController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Upload a product image (JPEG/PNG/WebP, 5 MB) or 3D model (GLB, 50 MB). Field name: "file". */
  @Post(':id/media/:kind') @RequirePermission('products:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @Me() me: CurrentUser,
    @Param('id') id: string,
    @Param('kind') rawKind: string,
    @UploadedFile() file: UploadedMedia | undefined,
  ) {
    const kind = this.kindOrThrow(rawKind);
    await this.productOrThrow(me.orgId, id);

    if (!file || file.buffer.length === 0) throw new BadRequestException('No file uploaded');
    if (file.buffer.length > MEDIA_LIMITS[kind]) {
      throw new BadRequestException(`File is too large (maximum ${MEDIA_LIMITS[kind] / (1024 * 1024)} MB)`);
    }

    const media = detectMedia(file.buffer);
    if (!media || !allowedFor(kind, media.mime)) {
      throw new BadRequestException(
        kind === 'image' ? 'Image must be a JPEG, PNG or WebP file' : '3D model must be a single-file .glb file',
      );
    }

    const dir = this.productDir(me.orgId, id);
    await mkdir(dir, { recursive: true });
    await this.removeStored(dir, kind); // replacing an upload removes the old file
    await writeFile(join(dir, `${kind}.${media.ext}`), file.buffer);

    // The version query string makes the browser fetch the new file instead of a cached one.
    const url = `/api/products/${id}/media/${kind}?v=${Date.now()}`;
    const updated = await this.prisma.product.update({
      where: { id },
      data: kind === 'image' ? { imageUrl: url } : { model3dUrl: url },
    });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'product.media.upload',
      entityType: 'Product',
      entityId: id,
      details: { kind, bytes: file.buffer.length },
    });
    return updated;
  }

  /** Streams the stored file. Only users of the same organization get it. */
  @Get(':id/media/:kind') @RequirePermission('products:read')
  async serve(@Me() me: CurrentUser, @Param('id') id: string, @Param('kind') rawKind: string) {
    const kind = this.kindOrThrow(rawKind);
    await this.productOrThrow(me.orgId, id);

    const dir = this.productDir(me.orgId, id);
    const name = (await this.listStored(dir)).find((n) => n.startsWith(`${kind}.`));
    if (!name) throw new NotFoundException('No file uploaded for this product');

    const ext = name.slice(kind.length + 1);
    return new StreamableFile(createReadStream(join(dir, name)), { type: mimeForExt(ext), disposition: 'inline' });
  }

  /** Removes the stored file and clears the product field. */
  @Delete(':id/media/:kind') @RequirePermission('products:write')
  async remove(@Me() me: CurrentUser, @Param('id') id: string, @Param('kind') rawKind: string) {
    const kind = this.kindOrThrow(rawKind);
    await this.productOrThrow(me.orgId, id);

    await this.removeStored(this.productDir(me.orgId, id), kind);
    const updated = await this.prisma.product.update({
      where: { id },
      data: kind === 'image' ? { imageUrl: null } : { model3dUrl: null },
    });
    await this.audit.record({
      organizationId: me.orgId,
      userId: me.id,
      action: 'product.media.delete',
      entityType: 'Product',
      entityId: id,
      details: { kind },
    });
    return updated;
  }

  private kindOrThrow(raw: string): MediaKind {
    const kind = parseKind(raw);
    if (!kind) throw new NotFoundException('Unknown media type');
    return kind;
  }

  private async productOrThrow(orgId: string, id: string) {
    if (!SAFE_ID.test(id)) throw new NotFoundException('Product not found');
    const p = await this.prisma.product.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
    if (!p) throw new NotFoundException('Product not found');
  }

  private productDir(orgId: string, productId: string): string {
    return join(uploadRoot(), orgId, productId);
  }

  private async listStored(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return []; // no folder yet means nothing was uploaded
    }
  }

  private async removeStored(dir: string, kind: MediaKind): Promise<void> {
    const names = (await this.listStored(dir)).filter((n) => n.startsWith(`${kind}.`));
    await Promise.all(names.map((n) => rm(join(dir, n), { force: true })));
  }
}
