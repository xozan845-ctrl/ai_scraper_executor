/**
 * Normalizador de comandos emitidos por LLM (robustez anti-alucinación).
 * Los modelos (especialmente los free) suelen:
 *  - usar "action"/"name" en vez de "type"
 *  - usar minúsculas ("navigate") en vez de MAYÚSCULAS
 *  - inventar comandos ("loop", "waitForSelector", "extractList")
 *  - envolver el comando en {command:{...}} o {action:{...}}
 * Esta capa intenta mapear al DSL real ANTES de la validación Zod.
 */

const ALIASES: Record<string, string> = {
  navigate: 'NAVIGATE',
  goto: 'NAVIGATE',
  open: 'NAVIGATE',
  inspect_page: 'INSPECT_PAGE',
  inspectpage: 'INSPECT_PAGE',
  inspect_links: 'INSPECT_LINKS',
  inspectlinks: 'INSPECT_LINKS',
  inspect_elements: 'INSPECT_ELEMENTS',
  inspectelements: 'INSPECT_ELEMENTS',
  extract: 'EXTRACT',
  extract_list: 'EXTRACT_LIST',
  extractlist: 'EXTRACT_LIST',
  'extract-list': 'EXTRACT_LIST',
  extract_table: 'EXTRACT_TABLE',
  extracttable: 'EXTRACT_TABLE',
  'extract-table': 'EXTRACT_TABLE',
  table: 'EXTRACT_TABLE',
  extract_text: 'EXTRACT_TEXT',
  extracttext: 'EXTRACT_TEXT',
  'extract-text': 'EXTRACT_TEXT',
  text: 'EXTRACT_TEXT',
  extract_structured: 'EXTRACT_STRUCTURED',
  extractstructured: 'EXTRACT_STRUCTURED',
  structured_data: 'EXTRACT_STRUCTURED',
  jsonld: 'EXTRACT_STRUCTURED',
  json_ld: 'EXTRACT_STRUCTURED',
  opengraph: 'EXTRACT_STRUCTURED',
  open_graph: 'EXTRACT_STRUCTURED',
  microdata: 'EXTRACT_STRUCTURED',
  extract_network: 'EXTRACT_NETWORK',
  extractnetwork: 'EXTRACT_NETWORK',
  network: 'EXTRACT_NETWORK',
  xhr: 'EXTRACT_NETWORK',
  api_data: 'EXTRACT_NETWORK',
  follow_links: 'FOLLOW_LINKS',
  followlinks: 'FOLLOW_LINKS',
  paginate: 'PAGINATE',
  pagination: 'PAGINATE',
  click: 'CLICK',
  type: 'TYPE',
  wait: 'WAIT',
  scroll: 'SCROLL',
  get_attribute: 'GET_ATTRIBUTE',
  getattribute: 'GET_ATTRIBUTE',
  finish: 'FINISH',
  done: 'FINISH',
  stop: 'FINISH',
  end: 'FINISH',
  authenticate: 'AUTHENTICATE',
  login: 'AUTHENTICATE',
};

const KNOWN_TYPES = new Set(Object.values(ALIASES));

export interface NormalizeResult {
  command: Record<string, unknown> | null;
  notes: string[];
}

/**
 * Normaliza un único comando. Devuelve { command: null } si no se puede mapear.
 */
export function normalizeRawCommand(raw: unknown): NormalizeResult {
  const notes: string[] = [];
  if (raw === null || typeof raw !== 'object') return { command: null, notes: ['no es objeto'] };
  let obj = { ...(raw as Record<string, unknown>) };

  // Desenvolver { command: {...} } o { action: { type: ... } } si el inner tiene type
  if (obj.command && typeof obj.command === 'object') {
    obj = { ...(obj.command as Record<string, unknown>) };
    notes.push('desenvuelto command');
  }

  // Resolver el tipo desde type/action/name/command/op
  const rawType =
    obj.type ??
    (typeof obj.action === 'string' ? obj.action : undefined) ??
    obj.name ??
    obj.command ??
    obj.op;
  if (typeof rawType !== 'string') return { command: null, notes: [...notes, 'sin type'] };

  let type = rawType.trim();
  const lower = type.toLowerCase().replace(/\s+/g, '_');
  // `Object.hasOwn`: evita que claves como `__proto__`/`constructor` resuelvan
  // contra el prototipo y se cuelen como "alias" (hallado por property-based, R-PB-1).
  if (Object.hasOwn(ALIASES, lower)) {
    if (type !== ALIASES[lower]) notes.push(`alias ${type}→${ALIASES[lower]}`);
    type = ALIASES[lower]!;
  } else {
    type = type.toUpperCase();
    if (!KNOWN_TYPES.has(type)) {
      return { command: null, notes: [...notes, `comando desconocido: ${rawType}`] };
    }
  }

  const out: Record<string, unknown> = { type };

  // Copiar campos válidos según el tipo (conservar los que ya usan los esquemas)
  const copy = (key: string, target = key) => {
    if (obj[key] !== undefined) out[target] = obj[key];
  };

  copy('url');
  copy('selector');
  copy('fields');
  copy('attribute');
  copy('limit');
  copy('maxLength');
  copy('source');
  copy('urlContains');
  copy('path');
  copy('maxSteps');
  copy('settleMs');
  copy('maxLinks');
  copy('maxPages');
  copy('pattern');
  copy('sameDomainOnly');
  copy('ms');
  copy('reason');
  // TYPE / AUTHENTICATE (antes se perdían y la validación los rechazaba).
  copy('text');
  copy('credential');
  copy('usernameSelector');
  copy('passwordSelector');
  copy('submitSelector');
  copy('successSelector');
  copy('captchaSelector');
  copy('mfaSelector');

  if (type === 'EXTRACT_STRUCTURED' && out.source === undefined) {
    const sourceByAlias: Record<string, string> = {
      jsonld: 'jsonld', json_ld: 'jsonld', opengraph: 'opengraph', open_graph: 'opengraph', microdata: 'microdata',
    };
    if (sourceByAlias[lower]) out.source = sourceByAlias[lower];
  }

  // Tolerancia a modelos débiles: username/password → *Selector.
  if (type === 'AUTHENTICATE') {
    if (out.usernameSelector === undefined && typeof obj.username === 'string') out.usernameSelector = obj.username;
    if (out.passwordSelector === undefined && typeof obj.password === 'string') out.passwordSelector = obj.password;
  }

  // Mapeos de campos comunes inventados
  if (out.selector === undefined && typeof obj.cssSelector === 'string') out.selector = obj.cssSelector;
  if (out.selector === undefined && typeof obj.target === 'string' && (type === 'CLICK' || type === 'PAGINATE'))
    out.selector = obj.target;
  if (type === 'FOLLOW_LINKS' && out.selector === undefined && typeof obj.linkSelector === 'string')
    out.selector = obj.linkSelector;
  if (type === 'PAGINATE' && out.maxPages === undefined && typeof obj.pages === 'number') out.maxPages = obj.pages;
  if ((type === 'EXTRACT_LIST' || type === 'EXTRACT_TABLE') && out.limit === undefined && typeof obj.maxItems === 'number') out.limit = obj.maxItems;

  // EXTRACT_LIST: si "fields" no existe pero hay "selectors"/"as", no inventamos; se validará.
  // NAVIGATE permite url dentro de selectors[0]? no: solo url.

  // EXTRACT_LIST sin "fields": inyectar campos por defecto sensatos (tolerancia a modelos débiles).
  if (type === 'EXTRACT_LIST' && out.fields === undefined) {
    out.fields = {
      name: 'h1, h2, h3, h4, .title, .name, .product-name, .nombre',
      price: '.price, .precio, [class*="price"], [class*="precio"]',
      link: { selector: 'a', attribute: 'href' },
      image: { selector: 'img', attribute: 'src' },
    };
    notes.push('fields por defecto inyectados en EXTRACT_LIST');
  }

  // Limpiar claves ruidosas dentro de fields si vienen como string[]
  if (type === 'EXTRACT_LIST' && Array.isArray(out.fields)) {
    const arr = out.fields as unknown[];
    const fieldsObj: Record<string, unknown> = {};
    for (const f of arr) if (typeof f === 'string') fieldsObj[f] = f;
    out.fields = fieldsObj;
    notes.push('fields array→objeto');
  }

  // Recortar a los topes del esquema ANTES de validar (el LLM puede excederlos y Zod
  // rechazaría el plan). El planner vuelve a recortar a los límites del job.
  clampToSchemaBounds(out, notes);

  return { command: out, notes };
}

function clampNum(v: unknown, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(Math.max(1, Math.floor(v)), max);
}

function clampToSchemaBounds(cmd: Record<string, unknown>, notes: string[]): void {
  const type = cmd.type;
  if (type === 'EXTRACT_LIST' || type === 'EXTRACT_TABLE' || type === 'EXTRACT_STRUCTURED' || type === 'EXTRACT_NETWORK') {
    const c = clampNum(cmd.limit, 1000);
    if (c !== undefined && c !== cmd.limit) { cmd.limit = c; notes.push('limit recortado a 1000'); }
  } else if (type === 'EXTRACT_TEXT') {
    const c = clampNum(cmd.maxLength, 10000);
    if (c !== undefined && c !== cmd.maxLength) { cmd.maxLength = c; notes.push('maxLength recortado a 10000'); }
  } else if (type === 'PAGINATE') {
    const c = clampNum(cmd.maxPages, 500);
    if (c !== undefined && c !== cmd.maxPages) { cmd.maxPages = c; notes.push('maxPages recortado a 500'); }
  } else if (type === 'FOLLOW_LINKS') {
    const c = clampNum(cmd.maxLinks, 500);
    if (c !== undefined && c !== cmd.maxLinks) { cmd.maxLinks = c; notes.push('maxLinks recortado a 500'); }
  }
}

/**
 * Normaliza un plan completo (array de acciones o {actions:[...]}).
 * Filtra comandos no mapeables y garantiza NAVIGATE inicial + FINISH.
 */
export function normalizeRawPlan(raw: unknown, baseUrl?: string): { actions: unknown[]; notes: string[] } {
  const notes: string[] = [];
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.actions)) list = o.actions;
    else if (Array.isArray(o.steps)) list = o.steps;
    else if (Array.isArray(o.plan)) list = o.plan;
  }
  if (list.length === 0) return { actions: [], notes: ['plan vacío'] };

  const actions: unknown[] = [];
  for (const item of list) {
    const { command, notes: n } = normalizeRawCommand(item);
    notes.push(...n);
    if (command) actions.push(command);
  }
  if (actions.length === 0) return { actions: [], notes };

  // Garantizar NAVIGATE inicial (la validación de dominio queda para el validator).
  const first = actions[0] as Record<string, unknown>;
  if (first.type !== 'NAVIGATE' && baseUrl) {
    actions.unshift({ type: 'NAVIGATE', url: baseUrl });
    notes.push('NAVIGATE antepuesto');
  }
  // NOTA: NO se añade FINISH automáticamente — el plan puede terminar en Fase B dinámica.
  return { actions, notes };
}
