#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = ['apps', 'libs'];
const LAYERS = ['domain', 'application', 'infrastructure', 'shared'];
const SOURCE_EXT = '.ts';
const IGNORED_DIRS = new Set(['dist', 'node_modules', 'coverage']);

// R-HX-11: contratos públicos que pertenecen al consumidor, nunca a infraestructura.
const OWNED_PORTS = [
  { port: 'JobStore', owner: '@ai-scraper/application-execution' },
  { port: 'SessionStore', owner: '@ai-scraper/application-execution' },
  { port: 'JobQueue', owner: '@ai-scraper/application-execution' },
  { port: 'JobMetrics', owner: '@ai-scraper/application-execution' },
  { port: 'EnginePageCache', owner: '@ai-scraper/application-execution' },
  { port: 'UserRepository', owner: '@ai-scraper/application-execution' },
  { port: 'SiteKnowledge', owner: '@ai-scraper/application-execution' },
  { port: 'RadiographyRunner', owner: '@ai-scraper/application-execution' },
  { port: 'SiteProfileReader', owner: '@ai-scraper/application-execution' },
  { port: 'SessionCredentials', owner: '@ai-scraper/application-execution' },
  { port: 'SessionJobGateway', owner: '@ai-scraper/application-execution' },
  { port: 'AICache', owner: '@ai-scraper/application-ai' },
  { port: 'AIProvider', owner: '@ai-scraper/application-ai' },
  { port: 'ScraperEngine', owner: '@ai-scraper/application-scraper' },
  { port: 'SiteMemory', owner: '@ai-scraper/application-scraper' },
  { port: 'ScraperMetrics', owner: '@ai-scraper/application-scraper' },
  { port: 'SiteCrawler', owner: '@ai-scraper/application-scraper' },
  { port: 'RadiographyProfileRepository', owner: '@ai-scraper/application-scraper' },
];

// R-HX-2: capas a las que puede depender cada capa. Dos adaptadores no se importan
// entre sí (`R-HX-12`), por eso `infrastructure` solo admite su propio paquete.
const ALLOWED = {
  shared: [],
  domain: ['domain', 'shared'],
  application: ['application', 'domain', 'shared'],
  infrastructure: ['application', 'domain', 'shared'],
  app: ['app', 'infrastructure', 'application', 'domain', 'shared'],
};

function layerFromDir(relPath) {
  const parts = relPath.split(sep);
  if (parts[0] === 'apps') return { layer: 'app', pkgDir: parts.slice(0, 2).join('/') };
  if (parts[0] === 'libs') {
    const layer = parts[1];
    return { layer: LAYERS.includes(layer) ? layer : 'unknown', pkgDir: parts.slice(0, 3).join('/') };
  }
  return { layer: 'unknown', pkgDir: '' };
}

function shortPackageName(relPath) {
  const parts = relPath.split(sep);
  if (parts[0] !== 'libs' || parts.length < 3) return '';
  return `${parts[1]}-${parts[2]}`;
}

function layerFromSpecifier(specifier) {
  const [maybeLayer] = specifier.replace('@ai-scraper/', '').split('-');
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
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(SOURCE_EXT) && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

function collectManifests() {
  const out = [];
  for (const scope of SCOPE) {
    const base = join(root, scope);
    let entries;
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const pkgDir = scope === 'libs'
        ? join(base, entry.name)
        : join(base, entry.name);
      const nested = scope === 'libs'
        ? readdirSync(pkgDir, { withFileTypes: true }).filter((item) => item.isDirectory())
        : [{ name: '.', isDirectory: () => true }];
      for (const child of nested) {
        if (!child.isDirectory()) continue;
        const manifestPath = scope === 'libs'
          ? join(pkgDir, child.name, 'package.json')
          : join(pkgDir, 'package.json');
        try {
          out.push({ dir: relative(root, join(manifestPath, '..')), manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) });
        } catch {
          // sin package.json: no es un workspace
        }
      }
    }
  }
  return out;
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"]@ai-scraper\/([a-z0-9-]+)['"]/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reexportFrom(owner) {
  return new RegExp(`export\\s+(?:type\\s+)?(?:\\*|\\{[^}]+\\})\\s+from\\s+['"]${escapeRegExp(owner)}['"]`);
}

const violations = [];
const ownershipViolations = [];
const manifestViolations = [];
let checked = 0;
let manifestsChecked = 0;

for (const scope of SCOPE) {
  for (const file of collectTsFiles(join(root, scope))) {
    const relFile = relative(root, file);
    const { layer: fromLayer } = layerFromDir(relFile);
    if (fromLayer === 'unknown') continue;
    const sourcePkg = shortPackageName(relFile);
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    if (fromLayer === 'infrastructure') {
      for (const { port, owner } of OWNED_PORTS) {
        const declaration = new RegExp(`export\\s+interface\\s+${port}\\b`);
        if (declaration.test(source)) ownershipViolations.push({ file: relFile, port, kind: 'declaración' });
        if (reexportFrom(owner).test(source)) {
          ownershipViolations.push({ file: relFile, port: owner, kind: 're-export' });
        }
      }
    }

    lines.forEach((line, i) => {
      for (const match of line.matchAll(IMPORT_RE)) {
        if (sourcePkg === match[1]) continue; // import dentro del mismo paquete
        checked += 1;
        const toLayer = layerFromSpecifier(`@ai-scraper/${match[1]}`);
        const allowed = ALLOWED[fromLayer] ?? [];
        if (fromLayer === 'infrastructure' && toLayer === 'infrastructure') {
          violations.push({
            file: relFile,
            line: i + 1,
            from: fromLayer,
            to: toLayer,
            specifier: `@ai-scraper/${match[1]}`,
            rule: 'R-HX-12',
          });
          continue;
        }
        if (allowed.includes(toLayer)) continue;
        violations.push({
          file: relFile,
          line: i + 1,
          from: fromLayer,
          to: toLayer,
          specifier: `@ai-scraper/${match[1]}`,
          rule: 'R-HX-2',
        });
      }
    });
  }
}

for (const { dir, manifest } of collectManifests()) {
  const relDir = dir.split(sep).join('/');
  const { layer } = layerFromDir(relDir);
  if (layer === 'unknown') continue;
  manifestsChecked += 1;
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const dependency of Object.keys(declared)) {
    if (!dependency.startsWith('@ai-scraper/')) continue;
    const toLayer = layerFromSpecifier(dependency);
    if (layer === 'infrastructure' && toLayer === 'infrastructure') {
      manifestViolations.push({ manifest: `${relDir}/package.json`, from: layer, to: toLayer, dependency, rule: 'R-HX-12' });
      continue;
    }
    if ((ALLOWED[layer] ?? []).includes(toLayer)) continue;
    manifestViolations.push({ manifest: `${relDir}/package.json`, from: layer, to: toLayer, dependency, rule: 'R-HX-2' });
  }
}

console.log(`[boundaries] ${checked} imports de fuente y ${manifestsChecked} manifests verificados (R-HX-2/R-HX-4/R-HX-12).`);

if (violations.length > 0) {
  console.error(`[boundaries] ${violations.length} violación(es) de aristas prohibidas (R-HX-2/R-HX-12):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.from} → ${v.to} (${v.specifier}) [${v.rule}]`);
  }
  process.exit(1);
}

if (manifestViolations.length > 0) {
  console.error(`[boundaries] ${manifestViolations.length} violación(es) en manifests (R-HX-2/R-HX-12):`);
  for (const v of manifestViolations) {
    console.error(`  ${v.manifest} — ${v.from} → ${v.to} (${v.dependency}) [${v.rule}]`);
  }
  process.exit(1);
}

if (ownershipViolations.length > 0) {
  console.error(`[boundaries] ${ownershipViolations.length} violación(es) de propiedad de puertos (R-HX-11):`);
  for (const violation of ownershipViolations) {
    console.error(`  ${violation.file} — ${violation.kind} de ${violation.port} en infraestructura`);
  }
  process.exit(1);
}

console.log('[boundaries] OK — ninguna arista prohibida ni dependencia entre adaptadores (R-HX-2/R-HX-12).');
console.log('[boundaries] OK — puertos extraídos pertenecen a application (R-HX-11).');
