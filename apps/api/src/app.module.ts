import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './common/prisma.service';
import { AuthGuard } from './common/auth.guard';
import { HealthController } from './health.controller';
import { AuditModule } from './audit/audit.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { EmailService } from './common/email.service';
import { UsersController } from './users/users.controller';
import { CustomersController } from './crm/customers.controller';
import { ProductsController } from './inventory/products.controller';
import { ProductMediaController } from './inventory/product-media.controller';
import { CategoriesController } from './categories/categories.controller';
import { SalesController } from './sales/sales.controller';
import { PaymentsController } from './finance/payments.controller';
import { ExpensesController } from './finance/finance.controller';
import { SummaryController } from './summary/summary.controller';
import { AssistantController } from './assistant/assistant.controller';
import { AssistantDataService } from './assistant/assistant-data.service';
import { SuppliersController } from './suppliers/suppliers.controller';
import { PurchasesController } from './purchases/purchases.controller';
import { LedgerController } from './finance/ledger.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { DocumentsController } from './documents/documents.controller';
import { SessionsController } from './auth/sessions.controller';
import { ReportExportController } from './reports/reports-export.controller';

@Module({
  imports: [AuditModule],
  controllers: [HealthController, AuthController, UsersController, CustomersController, ProductsController, ProductMediaController, CategoriesController, SalesController, PaymentsController, ExpensesController, SummaryController, AssistantController, SuppliersController, PurchasesController, LedgerController, AnalyticsController, DocumentsController, SessionsController, ReportExportController],
  providers: [
    PrismaService,
    AssistantDataService,
    AuthService,
    EmailService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
