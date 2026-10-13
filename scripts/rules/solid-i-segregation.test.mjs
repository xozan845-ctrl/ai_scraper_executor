// SOLID · ISP (Interface Segregation): las interfaces y DTOs expuestos se segregan
// por caso de uso. Un DTO no lo comparten controllers de casos distintos y ninguna
// interfaz expuesta es un "god interface" (demasiados miembros para un consumidor).
import { describe, it } from 'vitest';
import { collectSourceFiles, readSource, stripComments, toRel, namedImports, assertClean } from './_shared.mjs';

const RULE = 'ISP';
const MAX_MEMBERS = 20;

/** Cuenta miembros declarados en el cuerpo de una interfaz (heurística por líneas). */
function countMembers(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*') && !line.startsWith('('))
    .length;
}

function fatInterfaces() {
  const out = [];
  for (const file of collectSourceFiles(['libs/application', 'apps/api/src'])) {
    const rel = toRel(file);
    const code = stripComments(readSource(file));
    const re = /export\s+interface\s+([A-Za-z0-9_]+)\s*(?:<[^>{}]*>)?\s*(?:extends[^{]*)?\{/g;
    let match;
    while ((match = re.exec(code))) {
      const start = re.lastIndex;
      let depth = 1;
      let i = start;
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') { depth -= 1; if (depth === 0) break; }
        i += 1;
      }
      const members = countMembers(code.slice(start, i));
      if (members > MAX_MEMBERS) {
        out.push({ file: rel, detail: `interface ${match[1]} con ${members} miembros (> ${MAX_MEMBERS}): segrégala por consumidor` });
      }
    }
  }
  return out;
}

function sharedDtos() {
  const out = [];
  const dtoNames = new Set();
  for (const file of collectSourceFiles(['apps/api/src'], (p) => /\/dto\//.test(p))) {
    const code = stripComments(readSource(file));
    for (const match of code.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) dtoNames.add(match[1]);
  }
  const usage = new Map();
  for (const file of collectSourceFiles(['apps/api/src'], (p) => p.endsWith('.controller.ts'))) {
    const rel = toRel(file);
    const names = new Set();
    for (const imp of namedImports(stripComments(readSource(file)))) {
      if (!/dto/.test(imp.specifier)) continue;
      for (const name of imp.names) if (dtoNames.has(name)) names.add(name);
    }
    for (const name of names) {
      if (!usage.has(name)) usage.set(name, []);
      usage.get(name).push(rel);
    }
  }
  for (const [name, files] of usage) {
    if (files.length > 1) {
      out.push({ file: files.join(', '), detail: `DTO ${name} compartido por ${files.length} controllers: segrégala por caso de uso` });
    }
  }
  return out;
}

describe('SOLID-ISP · interfaces y DTOs segregados por consumidor', () => {
  it('ninguna interfaz expuesta es un "god interface"', () => {
    assertClean(RULE, fatInterfaces());
  });
  it('cada DTO lo consume un único controller', () => {
    assertClean(RULE, sharedDtos());
  });
});
