#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = ['apps', 'packages', 'libs'];
const LAYERS = ['domain', 'application', 'infrastructure', 'shared'];
const SOURCE_EXT = '.ts';

// R-HX-2: capas a las que puede importar cada capa (una lib nunca importa de apps/*).
const ALLOWED = {
  shared: [],
  domain: ['domain', 'shared'],
  application: ['application', 'domain', 'shared'],
  infrastructure: ['infrastructure', 'application', 'domain', 'shared'],
  app: ['app', 'infrastructure', 'application', 'domain', 'shared'],
};

// Clasificación de los paquetes vigentes (migración strangler, R-HX-9). Al mover un
// paquete a libs/<capa>/<contexto> su capa pasa a deducirse del nombre de paquete.
const PACKAGE_LAYERS = {
  ai: 'application',
  crawler: 'infrastructure',
  'execution-engine': 'infrastructure',
  'ai-providers': 'infrastructure',
  mongodb: 'infrastructure',
  redis: 'infrastructure',
  storage: 'infrastructure',
  queue: 'infrastructure',
};

// Aristas legacy toleradas mientras convivan packages/ y libs/ (ADR-30). Se declaran
// por ruta del paquete origen: al migrar, la clave deja de coincidir y la excepción
// desaparece sola. Deben quedar a 0 al cerrar F5.
const LEGACY_EXCEPTIONS = {
  'packages/ai': new Set(['@ai-scraper/redis']),
};

function layerFromDir(relPath) {
  const parts = relPath.split(sep);
  if (parts[0] === 'apps') return { layer: 'app', pkgDir: parts.slice(0, 2).join('/') };
  if (parts[0] === 'libs') {
    const layer = parts[1];
    return { layer: LAYERS.includes(layer) ? layer : 'unknown', pkgDir: parts.slice(0, 3).join('/') };
  }
  if (parts[0] === 'packages') {
    return { layer: PACKAGE_LAYERS[parts[1]] ?? 'unknown', pkgDir: parts.slice(0, 2).join('/') };
  }
  return { layer: 'unknown', pkgDir: '' };
}

function layerFromSpecifier(specifier) {
  const name = specifier.replace('@ai-scraper/', '');
  if (PACKAGE_LAYERS[name]) return PACKAGE_LAYERS[name];
  const [maybeLayer] = name.split('-');
  return LAYERS.includes(maybeLayer) ? maybeLayer : 'unknown';
}

function collectTsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(SOURCE_EXT) && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"]@ai-scraper\/([a-z0-9-]+)['"]/g;
const violations = [];
let checked = 0;

for (const scope of SCOPE) {
  for (const file of collectTsFiles(join(root, scope))) {
    const relFile = relative(root, file);
    const { layer: fromLayer, pkgDir } = layerFromDir(relFile);
    if (fromLayer === 'unknown') continue;
    const sourcePkg = pkgDir.split('/').pop();
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const match of line.matchAll(IMPORT_RE)) {
        const specifier = `@ai-scraper/${match[1]}`;
        if (sourcePkg === match[1]) continue; // auto-import
        checked += 1;
        const toLayer = layerFromSpecifier(specifier);
        const allowed = ALLOWED[fromLayer] ?? [];
        if (allowed.includes(toLayer)) continue;
        if (LEGACY_EXCEPTIONS[pkgDir]?.has(specifier)) continue;
        violations.push({ file: relFile, line: i + 1, from: fromLayer, to: toLayer, specifier, pkgDir });
      }
    });
  }
}

const legacy = Object.entries(LEGACY_EXCEPTIONS).flatMap(([from, set]) => [...set].map((to) => `${from} → ${to}`));
console.log(`[boundaries] ${checked} imports entre paquetes verificados; ${legacy.length} excepción(es) legacy toleradas.`);

if (violations.length > 0) {
  console.error(`[boundaries] ${violations.length} violación(es) de R-HX-2:`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.from} → ${v.to} (${v.specifier})`);
  }
  process.exit(1);
}

console.log('[boundaries] OK — ninguna arista prohibida (R-HX-2).');
