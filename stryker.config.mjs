/** Config de mutation testing (R-MT-1/R-MT-2, ADR-31). No es un gate de PR: se
 * ejecuta a mano pre-release (`npm run test:mutation`) sobre el área crítica.
 *
 * Usa el **command runner**: muta el fichero en disco y lanza la suite en un **proceso
 * nuevo** por mutante, así que SÍ detecta mutantes de **cuerpo de función**. El runner de
 * Vitest (in-process) los pierde por un bug conocido de Stryker+Vitest
 * (stryker-js #6073/#4306: under-selection de tests y "runs sin tests" → falsos
 * supervivientes). Es más lento: scopea con `--mutate <fichero>` si hace falta. */
export default {
  testRunner: 'command',
  // Tests de la lógica pura del área crítica (sin los tests de estado como dashboard/
  // persistence, que se contaminan al correr todos juntos dentro del sandbox).
  commandRunner: {
    command:
      'npx vitest run tests/domain-execution.test.mjs tests/limits.test.mjs tests/property.test.mjs tests/normalize.test.mjs tests/dsl.test.mjs tests/dsl-completeness.test.mjs tests/security.test.mjs tests/browser-ssrf.test.mjs tests/credentials.test.mjs tests/util-unify.test.mjs',
  },
  // Área crítica R-MT-2: DSL/límites/trazabilidad + SSRF (la frontera de seguridad).
  mutate: [
    'libs/domain/**/dist/**/*.js',
    'libs/shared/core/dist/**/*.js',
    'libs/shared/security/dist/**/*.js',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // R-MT-2: ≥90 % (DSL/SSRF/límites), ≥80 % (resto), <70 % bloquea release.
  // `break: null` mientras no haya baseline medido; el release exige ≥70.
  thresholds: { high: 90, low: 70, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  concurrency: 2,
  timeoutMS: 60000,
};
