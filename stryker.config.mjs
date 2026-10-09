/** Config de mutation testing (R-MT-1/R-MT-2, ADR-20). No es un gate de PR: se
 * ejecuta a mano pre-release (`npm run test:mutation`) sobre el área crítica.
 * Muta el **JS compilado** (`dist`), que es lo que importan los tests (ADR-29). */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  // Área crítica R-MT-2: DSL/límites/trazabilidad + SSRF (la frontera de seguridad).
  mutate: [
    'libs/domain/**/dist/**/*.js',
    'libs/shared/core/dist/**/*.js',
    'libs/shared/security/dist/**/*.js',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // R-MT-2: ≥90 % (DSL/SSRF/límites), ≥80 % (resto), <70 % bloquea release.
  // `break: null` mientras no haya baseline medido; el release exige ≥70.
  thresholds: { high: 90, low: 70, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  concurrency: 2,
  timeoutMS: 30000,
};
