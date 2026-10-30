
import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from './audit.service';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';

@Controller('audit')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit:read')
  list(@Me() me: CurrentUser, @Query('limit') limit = '100') {
    return this.prisma.auditEvent.findMany({
      where: { organizationId: me.orgId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
    });
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [PrismaService, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
