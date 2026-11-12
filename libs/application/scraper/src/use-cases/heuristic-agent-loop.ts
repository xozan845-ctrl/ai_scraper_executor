import { CommandValidator } from '@ai-scraper/domain-ai';
import type { ScraperEngine } from '../ports/scraper-engine';

export interface HeuristicAgentJob {
  id: string;
  url: string;
  instruction: string;
  listSelector?: string;
}

export interface HeuristicAgentDeps {
  engine: ScraperEngine;
  /** Política inyectada por el borde (`R-HX-13`). */
  allowPrivateHosts?: boolean;
}

/**
 * Loop determinista sin IA para `DEMO_URL` (FASE 1/2):
 * NAVIGATE → INSPECT_LINKS → INSPECT_ELEMENTS → EXTRACT_LIST → FINISH.
 */
export async function runHeuristicAgentLoop(job: HeuristicAgentJob, deps: HeuristicAgentDeps): Promise<unknown[]> {
  console.log(`[JOB] ${job.id} started`);
  console.log(`[AI] Planning... :: ${job.instruction} (heuristic FASE 2, sin LLM)`);

  const validator = new CommandValidator({
    allowedDomain: new URL(job.url).hostname,
    maxDepth: 5,
    maxPages: 100,
    allowPrivateHosts: deps.allowPrivateHosts ?? false,
  });

  const exec = async (command: unknown) => {
    const valid = validator.validateCommand(command);
    const result = await deps.engine.execute(valid as unknown as Record<string, unknown>);
    console.log(`[${result.ok ? 'OK' : 'FAIL'}] ${result.commandType}${result.count !== undefined ? ` (${result.count})` : ''}${result.error ? ` :: ${result.error}` : ''}`);
    return result;
  };

  await exec({ type: 'NAVIGATE', url: job.url });
  await exec({ type: 'INSPECT_LINKS' });
  const elements = await exec({ type: 'INSPECT_ELEMENTS' });

  const discovered = (elements.items as Array<{ selector?: string }> | undefined)?.[0]?.selector;
  const selector = job.listSelector ?? discovered ?? '.product-card';

  const extracted = await exec({
    type: 'EXTRACT_LIST',
    selector,
    fields: {
      name: '.name, h2, h3, a',
      price: '.price, [class*="price"]',
      link: { selector: 'a', attribute: 'href' },
    },
    limit: 50,
  });

  await exec({ type: 'FINISH' });
  console.log(`[JOB] ${job.id} completed (${extracted.count ?? 0} items)`);
  return (extracted.items as unknown[]) ?? [];
}
