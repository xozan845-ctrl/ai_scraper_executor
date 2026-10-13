// SOLID · DIP (Dependency Inversion): el núcleo no depende de detalles de bajo nivel.
// - `libs/domain` y `libs/application` no leen `process.env` (reciben config por puerto).
// - El núcleo no importa infraestructura ni `apps/*`.
// - Servicios y controllers inyectan dependencias; no las instancian con `new`
//   (salvo builtins, excepciones HTTP y utilidades de framework como Logger).
import { describe, it } from 'vitest';
import { collectSourceFiles, readSource, stripComments, importSpecifiers, toRel, assertClean } from './_shared.mjs';

const RULE = 'DIP';
const CORE = ['libs/domain', 'libs/application'];
const BUILTINS = new Set([
  'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'URL', 'URLSearchParams', 'RegExp', 'Promise', 'Array',
  'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'Buffer', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'DOMException',
  'Uint8Array', 'Int32Array', 'Float64Array', 'Intl',
]);
// Utilidades de framework que Nest instancia directamente (no son dependencias inyectables).
const ALLOWED_NEW = new Set(['Logger']);

function coreReadsEnv() {
  const out = [];
  for (const file of collectSourceFiles(CORE)) {
    const rel = toRel(file);
    stripComments(readSource(file)).split('\n').forEach((line, idx) => {
      if (/\bprocess\.env\b/.test(line)) {
        out.push({ file: rel, line: idx + 1, detail: 'el núcleo (domain/application) no debe leer process.env: recibe config por puerto' });
      }
    });
  }
  return out;
}

function coreImportsInfra() {
  const out = [];
  for (const file of collectSourceFiles(CORE)) {
    const rel = toRel(file);
    for (const { specifier, line } of importSpecifiers(stripComments(readSource(file)))) {
      if (specifier.startsWith('@ai-scraper/infrastructure-') || /(^|\/)apps\//.test(specifier)) {
        out.push({ file: rel, line, detail: `el núcleo no debe importar infraestructura/apps ('${specifier}')` });
      }
    }
  }
  return out;
}

function appInstantiation() {
  const out = [];
  const files = collectSourceFiles(['apps/api/src'], (p) => p.endsWith('.service.ts') || p.endsWith('.controller.ts'));
  const re = /new\s+([A-Za-z0-9_$]+)\s*\(/g;
  for (const file of files) {
    const rel = toRel(file);
    const kind = file.endsWith('.controller.ts') ? 'controller' : 'servicio';
    stripComments(readSource(file)).split('\n').forEach((line, idx) => {
      for (const match of line.matchAll(re)) {
        const name = match[1];
        if (BUILTINS.has(name) || name.endsWith('Exception') || name.endsWith('Error') || ALLOWED_NEW.has(name)) continue;
        out.push({ file: rel, line: idx + 1, detail: `instanciación 'new ${name}(...)' en ${kind}: inyecta la dependencia (DIP)` });
      }
    });
  }
  return out;
}

describe('SOLID-DIP · inversión de dependencias', () => {
  it('el núcleo no lee process.env', () => {
    assertClean(RULE, coreReadsEnv());
  });
  it('el núcleo no depende de infraestructura ni de apps', () => {
    assertClean(RULE, coreImportsInfra());
  });
  it('servicios y controllers no instancian dependencias', () => {
    assertClean(RULE, appInstantiation());
  });
});
