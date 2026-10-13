// SOLID · SRP (Single Responsibility): capas y orquestación HTTP.
// - Una lib no depende del framework HTTP (express/@nestjs).
// - Solo los `*.controller.ts` importan tipos de Express (Request/Response).
// - Un controller solo orquesta HTTP: no accede a persistencia directamente.
import { describe, it } from 'vitest';
import { collectSourceFiles, readSource, stripComments, importSpecifiers, toRel, assertClean } from './_shared.mjs';

const RULE = 'SRP';
const DATA_LAYER = [/^@ai-scraper\/infrastructure-/, /^@prisma\/client$/];

function scan() {
  const out = [];

  for (const file of collectSourceFiles(['libs'])) {
    const rel = toRel(file);
    const code = stripComments(readSource(file));
    for (const { specifier, line } of importSpecifiers(code)) {
      if (specifier === 'express' || specifier.startsWith('@nestjs/')) {
        out.push({ file: rel, line, detail: `una lib no debe importar el framework HTTP ('${specifier}')` });
      }
    }
  }

  for (const file of collectSourceFiles(['apps/api/src'], (p) => !p.endsWith('.controller.ts'))) {
    const rel = toRel(file);
    const code = stripComments(readSource(file));
    for (const { specifier, line } of importSpecifiers(code)) {
      if (specifier === 'express') {
        out.push({ file: rel, line, detail: 'solo los *.controller.ts pueden importar tipos de Express' });
      }
    }
  }

  for (const file of collectSourceFiles(['apps/api/src'], (p) => p.endsWith('.controller.ts'))) {
    const rel = toRel(file);
    const code = stripComments(readSource(file));
    for (const { specifier, line } of importSpecifiers(code)) {
      if (DATA_LAYER.some((re) => re.test(specifier))) {
        out.push({ file: rel, line, detail: `un controller no debe acceder a persistencia ('${specifier}'): delega en un servicio` });
      }
    }
  }

  return out;
}

describe('SOLID-SRP · capas y orquestación HTTP', () => {
  it('libs sin framework HTTP, express solo en controllers y controllers sin persistencia', () => {
    assertClean(RULE, scan());
  });
});
