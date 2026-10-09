/**
 * Agent Loop §47 — FASE 1/2 cableado sin IA (determinista).
 * FASE 4/5 sustituirán `decideHeuristic` por AIOrchestrator + prompts.
 *
 * Flujo actual: NAVIGATE -> INSPECT_LINKS -> INSPECT_ELEMENTS -> EXTRACT_LIST -> FINISH
 * con CommandValidator (§26) y ExecutionEngine (§27) reales.
 */
import { ExecutionEngine } from '@ai-scraper/execution-engine';
import { CommandValidator } from '@ai-scraper/domain-ai';

export interface AgentJob {
  id: string;
  url: string;
  instruction: string;
  listSelector?: string;
}

export async function runAgentLoop(job: AgentJob): Promise<unknown[]> {
  console.log(`[JOB] ${job.id} started`);
  console.log(`[AI] Planning... :: ${job.instruction} (heuristic FASE 2, sin LLM)`);

  const domain = new URL(job.url).hostname;
  const validator = new CommandValidator({ allowedDomain: domain, maxDepth: 5, maxPages: 100 });
  const engine = new ExecutionEngine();

  const exec = async (cmd: unknown) => {
    const valid = validator.validateCommand(cmd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await engine.execute(valid as any);
    console.log(`[${res.ok ? 'OK' : 'FAIL'}] ${res.commandType}${res.count !== undefined ? ` (${res.count})` : ''}${res.error ? ` :: ${res.error}` : ''}`);
    return res;
  };

  await exec({ type: 'NAVIGATE', url: job.url });
  await exec({ type: 'INSPECT_LINKS' });
  const els = await exec({ type: 'INSPECT_ELEMENTS' });

  // Heurística: usar selector descubierto o el aportado por el job.
  const discovered = (els.items as Array<{ selector?: string }>)?.[0]?.selector;
  const selector = job.listSelector ?? discovered ?? '.product-card';

  const extracted = await exec({
    type: 'EXTRACT_LIST',
    selector,
    fields: { name: '.name, h2, h3, a', price: '.price, [class*="price"]', link: { selector: 'a', attribute: 'href' } },
    limit: 50,
  });

  await exec({ type: 'FINISH' });
  console.log(`[JOB] ${job.id} completed (${extracted.count ?? 0} items)`);
  return (extracted.items as unknown[]) ?? [];
}
