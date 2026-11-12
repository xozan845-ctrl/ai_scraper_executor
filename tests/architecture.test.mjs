import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  ROOT,
  collectSourceFiles,
  readSource,
  stripComments,
  importSpecifiers,
  toRel,
} from '../scripts/rules/_shared.mjs';

function ownAdapter(relFile) {
  const parts = relFile.split('/');
  return parts[0] === 'libs' && parts[1] === 'infrastructure' ? `${parts[1]}-${parts[2]}` : null;
}

describe('F10 — arquitectura hexagonal verificable (R-HX-14)', () => {
  it('boundaries:check valida fuentes y manifests', () => {
    const output = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-boundaries.mjs')], {
      encoding: 'utf8',
    });
    assert.match(output, /imports de fuente y \d+ manifests verificados/);
    assert.match(output, /puertos extraídos pertenecen a application/);
  });

  it('ningún adaptador importa otro adaptador (R-HX-12)', () => {
    const offences = [];
    for (const file of collectSourceFiles(['libs/infrastructure'])) {
      const own = ownAdapter(toRel(file));
      for (const { specifier, line } of importSpecifiers(stripComments(readSource(file)))) {
        if (!specifier.startsWith('@ai-scraper/infrastructure-')) continue;
        const imported = specifier.replace('@ai-scraper/', '');
        if (own && imported !== own) offences.push(`${toRel(file)}:${line} → ${specifier}`);
      }
    }
    assert.deepEqual(offences, []);
  });

  it('infraestructura no declara puertos de negocio (R-HX-11)', () => {
    const portDeclaration = /export\s+(?:interface|abstract class)\s+(\w*(?:Store|Repository|Queue|Provider|Engine|Cache|Metrics))\b/g;
    const offences = [];
    for (const file of collectSourceFiles(['libs/infrastructure'])) {
      const code = stripComments(readSource(file));
      for (const match of code.matchAll(portDeclaration)) {
        offences.push(`${toRel(file)} → ${match[1]}`);
      }
    }
    assert.deepEqual(offences, []);
  });

  it('el worker no define workflows de negocio (R-HX-10)', () => {
    const workflows = /(?:class|function|const)\s+(AgentRunner|processJob|generatePlan|performRadiography|runHeuristicAgentLoop)\b/;
    const offences = [];
    for (const file of collectSourceFiles(['apps/worker/src'])) {
      const code = stripComments(readSource(file));
      if (workflows.test(code)) offences.push(toRel(file));
    }
    assert.deepEqual(offences, []);
  });

  it('controllers no importan adaptadores concretos fuera de la composición', () => {
    const offences = [];
    for (const file of collectSourceFiles(['apps/api/src'])) {
      const rel = toRel(file);
      if (!rel.endsWith('.controller.ts')) continue;
      for (const { specifier, line } of importSpecifiers(stripComments(readSource(file)))) {
        if (specifier.startsWith('@ai-scraper/infrastructure-')) offences.push(`${rel}:${line} → ${specifier}`);
      }
    }
    assert.deepEqual(offences, []);
  });
});
