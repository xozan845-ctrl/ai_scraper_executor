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
  follow_links: 'FOLLOW_LINKS',
  followlinks: 'FOLLOW_LINKS',
  paginate: 'PAGINATE',
  pagination: 'PAGINATE',
  click: 'CLICK',
  wait: 'WAIT',
  scroll: 'SCROLL',
  get_attribute: 'GET_ATTRIBUTE',
  getattribute: 'GET_ATTRIBUTE',
  finish: 'FINISH',
  done: 'FINISH',
  stop: 'FINISH',
  end: 'FINISH',
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
  if (ALIASES[lower]) {
    if (type !== ALIASES[lower]) notes.push(`alias ${type}→${ALIASES[lower]}`);
    type = ALIASES[lower];
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
  copy('maxLinks');
  copy('maxPages');
  copy('pattern');
  copy('sameDomainOnly');
  copy('ms');
  copy('reason');

  // Mapeos de campos comunes inventados
  if (out.selector === undefined && typeof obj.cssSelector === 'string') out.selector = obj.cssSelector;
  if (out.selector === undefined && typeof obj.target === 'string' && (type === 'CLICK' || type === 'PAGINATE'))
    out.selector = obj.target;
  if (type === 'FOLLOW_LINKS' && out.selector === undefined && typeof obj.linkSelector === 'string')
    out.selector = obj.linkSelector;
  if (type === 'PAGINATE' && out.maxPages === undefined && typeof obj.pages === 'number') out.maxPages = obj.pages;
  if (type === 'EXTRACT_LIST' && out.limit === undefined && typeof obj.maxItems === 'number') out.limit = obj.maxItems;

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

  return { command: out, notes };
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
