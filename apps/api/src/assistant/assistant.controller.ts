import { BadGatewayException, BadRequestException, Body, Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { Me, CurrentUser, RequirePermission } from '../common/decorators';
import { RateLimiter } from '../common/rate-limit';
import { ruleGuard } from '../common/rule-guard';
import { reportOffsetMinutes } from '../analytics/analytics-rules';
import { AskAssistantDto } from './assistant.dto';
import { AssistantDataService } from './assistant-data.service';
import { planQuestion, renderContext, ToolName, ToolResult } from './assistant-tools';

/** Each AI call costs money: 20 questions per user per minute. */
const askLimiter = new RateLimiter(20, 60_000);

@Controller('assistant')
export class AssistantController {
  constructor(private data: AssistantDataService) {}

  /**
   * Ask TIBEB AI. The browser sends only the question and earlier turns.
   *
   * 1. The API resolves the tenant and role from the session (never from the request).
   * 2. A deterministic planner picks at most three allowlisted read-only tools from the question and checks
   *    each one against the caller's role.
   * 3. The data service runs those queries, scoped to the caller's organization.
   * 4. Only the bounded, formatted results are sent to the AI service, which explains them. The model never
   *    writes SQL and never chooses a table or a tool.
   * The response carries the sources (metric, period, record count) so the answer can be checked.
   */
  @Post('ask') @RequirePermission('sales:read')
  async ask(@Me() me: CurrentUser, @Body() dto: AskAssistantDto) {
    const message = (dto.message ?? '').trim();
    if (!message && !dto.attachments?.length) throw new BadRequestException('Send a message or attach a file.');

    // Fail closed: without the shared token the AI service would be reachable by anyone who knows its address.
    const token = process.env.AI_SERVICE_TOKEN;
    if (!token) throw new ServiceUnavailableException('The AI assistant is not configured (AI_SERVICE_TOKEN is missing).');

    askLimiter.consume(me.id);

    const history = (dto.history ?? []).map((h) => ({ role: h.role, content: String(h.content ?? '').slice(0, 4000) }));
    const plan = ruleGuard(() => planQuestion({ message, history, now: new Date(), offsetMin: reportOffsetMinutes() }));

    let context = '';
    let results: ToolResult[] = [];
    let denied: ToolName[] = [];
    const sendBusinessData = process.env.AI_SEND_BUSINESS_CONTEXT !== 'false';
    if (sendBusinessData) {
      const run = await this.data.run(me.orgId, me.role, plan);
      results = run.results;
      denied = run.denied;
      context = renderContext(plan, results, run.denied);
    }

    const base = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
    let res: any;
    try {
      res = await fetch(`${base}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Token': token },
        body: JSON.stringify({
          message,
          language: dto.language ?? 'auto',
          history,
          attachments: dto.attachments ?? [],
          context,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ServiceUnavailableException('The AI service is not running. Start it: cd apps/ai-service && uvicorn main:app --port 8000');
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadGatewayException(data.detail || `The AI service returned HTTP ${res.status}`);

    return {
      ...data,
      period: { from: plan.period.range.from, to: plan.period.range.to, label: plan.period.label, source: plan.period.source },
      sources: results.map((r) => ({
        metric: r.label,
        period: r.period,
        currency: r.currency,
        recordCount: r.recordCount,
        source: r.source,
        unavailable: r.unavailable,
      })),
      deniedMetrics: denied,
      grounded: results.length > 0 && results.every((r) => !r.unavailable),
    };
  }
}
