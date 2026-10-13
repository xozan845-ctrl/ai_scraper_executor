// Utilidades compartidas por las suites de gobernanza SOLID (scripts/rules).
// Analizan el código TS estático (sin ejecutarlo) para detectar violaciones reales
// de SRP/OCP/LSP/ISP/DIP en la arquitectura NestJS. No forman parte del runtime.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import assert from 'node:assert/strict';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(full);
  }
}

/** Ficheros .ts bajo `dirs` (relativos a la raíz), con filtro opcional por ruta absoluta. */
export function collectSourceFiles(dirs, predicate) {
  const out = [];
  for (const rel of dirs) walk(join(ROOT, rel), out);
  return predicate ? out.filter(predicate) : out;
}

/** Ruta relativa a la raíz con separadores POSIX (estable para los mensajes). */
export function toRel(file) {
  return relative(ROOT, file).split(sep).join('/');
}

export function readSource(file) {
  return readFileSync(file, 'utf8');
}

/**
 * Elimina comentarios de línea y bloque conservando el número de líneas y el
 * contenido de strings/template literals (evita falsos positivos y no corta URLs).
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = null;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === null) {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; out += '  '; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; out += '  '; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = null; out += c; } else out += ' '; i += 1; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = null; i += 2; out += '  '; } else { out += c === '\n' ? '\n' : ' '; i += 1; } continue; }
    out += c;
    if (c === '\\') { out += next ?? ''; i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = null;
    i += 1;
  }
  return out;
}

/** Especificadores importados (estáticos y dinámicos), con su línea 1-based. */
export function importSpecifiers(code) {
  const out = [];
  code.split('\n').forEach((line, idx) => {
    const ln = idx + 1;
    for (const m of line.matchAll(/from\s*['"]([^'"]+)['"]/g)) out.push({ specifier: m[1], line: ln });
    for (const m of line.matchAll(/^\s*import\s*['"]([^'"]+)['"]/g)) out.push({ specifier: m[1], line: ln });
    for (const m of line.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g)) out.push({ specifier: m[1], line: ln });
  });
  return out;
}

/** Imports con nombres (`import { A, B as C } from 'x'`) → [{ specifier, names }]. */
export function namedImports(code) {
  const out = [];
  const re = /\bimport\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const names = m[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ specifier: m[2], names });
  }
  return out;
}

const BASELINE_PATH = join(ROOT, 'scripts', 'rules', 'baseline.json');

/** Deuda SOLID aceptada temporalmente (ratchet): solo bloquea violaciones NUEVAS. */
export function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`baseline.json inválido: ${error.message}`, { cause: error });
  }
}

function isBaselined(entry, violation) {
  if (entry.file !== violation.file) return false;
  return !entry.match || String(violation.detail).includes(entry.match);
}

/** Asume el gate: falla solo con las violaciones que no estén en el baseline. */
export function assertClean(rule, violations) {
  const entries = loadBaseline()[rule] ?? [];
  const kept = [];
  let baselined = 0;
  for (const violation of violations) {
    if (entries.some((entry) => isBaselined(entry, violation))) baselined += 1;
    else kept.push(violation);
  }
  if (baselined > 0) {
    console.warn(`[rules:${rule}] ${baselined} excepción(es) aceptada(s) en baseline (deuda conocida: scripts/rules/baseline.json).`);
  }
  if (kept.length > 0) {
    const lines = kept.map((v) => `  - ${v.file}${v.line ? `:${v.line}` : ''} — ${v.detail}`).join('\n');
    assert.fail(`[rules:${rule}] ${kept.length} violación(es) SOLID:\n${lines}`);
  }
}
