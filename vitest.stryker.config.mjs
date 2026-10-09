import base from './vitest.config.mjs';

/** Config de Vitest para Stryker (ADR-31): sin reporter JUnit y con pool de procesos,
 * para que cada mutante se evalúe en un proceso limpio (evita módulos cacheados). */
export default {
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
    isolate: true,
    reporters: ['default'],
    coverage: { enabled: false },
  },
  // Sin externalizar el `dist`: Stryker muta el fichero y Vite debe reinterpretarlo
  // (externalizarlo lo cargaría por caché nativa e ignoraría la mutación).
  server: { deps: { external: [] } },
};
