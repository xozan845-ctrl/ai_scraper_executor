// SOLID · LSP (Liskov Substitution): guards, interceptores, middleware y filtros
// respetan el contrato de excepciones de Nest. Nunca lanzan `new Error(...)` crudo
// (rompería el mapeo uniforme a respuestas HTTP); usan HttpException o *Exception.
import { describe, it } from 'vitest';
import { collectSourceFiles, readSource, stripComments, toRel, assertClean } from './_shared.mjs';

const RULE = 'LSP';
const THROW_NEW = /throw\s+new\s+([A-Za-z0-9_$]+)\s*\(/g;

function scan() {
  const out = [];
  const files = collectSourceFiles(['apps/api/src'], (p) => /\.(guard|interceptor|middleware|filter)\.ts$/.test(p));
  for (const file of files) {
    const rel = toRel(file);
    stripComments(readSource(file)).split('\n').forEach((line, idx) => {
      for (const match of line.matchAll(THROW_NEW)) {
        const name = match[1];
        if (name === 'Error' || !name.endsWith('Exception')) {
          out.push({ file: rel, line: idx + 1, detail: `throw new ${name}(...) rompe el contrato Nest; usa HttpException o *Exception` });
        }
      }
    });
  }
  return out;
}

describe('SOLID-LSP · guards/middleware respetan HttpException', () => {
  it('sin Error crudo: solo HttpException/*Exception', () => {
    assertClean(RULE, scan());
  });
});
