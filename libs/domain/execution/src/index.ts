/**
 * @ai-scraper/domain-execution — bounded context de ejecución.
 * Entidades y presupuestos del ciclo de vida de un job. Dominio **puro**: sin
 * frameworks, sin I/O y sin dependencias de infraestructura (`R-HX-3`).
 * Principio: la IA decide QUÉ, el motor decide CÓMO.
 */

export * from './entities/job';
export * from './value-objects/job-limits';
