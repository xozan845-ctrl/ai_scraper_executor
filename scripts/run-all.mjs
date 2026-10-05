/**
 * Ejecuta todos los escenarios de la API y resume PASS/FAIL.
 *   node scripts/run-all.mjs             # todos (incluye scraping real)
 *   node scripts/run-all.mjs --skip-slow # solo los rápidos
 *
 * Config: API_URL, API_KEY, TEST_URL (ver scripts/README.md).
 */
import { createClient } from './client.mjs';
import { t } from './harness.mjs';
import health from './flows/00-health.mjs';
import sessionChat from './flows/01-session-chat.mjs';
import sessionsHistory from './flows/02-sessions-history.mjs';
import credentials from './flows/03-credentials.mjs';
import jobs from './flows/04-jobs.mjs';
import radiography from './flows/05-radiography.mjs';
import errors from './flows/06-errors.mjs';
import productosStockVentas from './flows/07-productos-stock-ventas.mjs';

const skipSlow = process.argv.includes('--skip-slow');
const all = [health, sessionChat, sessionsHistory, credentials, jobs, radiography, errors, productosStockVentas];
const flows = skipSlow ? all.filter((f) => !f.slow) : all;

const client = createClient();
console.log(`Base URL: ${client.baseUrl}`);
console.log(`API key:  ${client.hasKey ? 'configurada' : 'no'}`);
console.log(`TEST_URL: ${process.env.TEST_URL || 'https://www.sevasaonline.com/'}`);
console.log(`Escenarios: ${flows.map((f) => f.name).join(', ')}`);

const failed = [];
for (const flow of flows) {
  console.log(`\n########## ${flow.name} ##########`);
  try {
    await flow.run(client, t);
    console.log(`PASS  ${flow.name}`);
  } catch (e) {
    failed.push(flow.name);
    console.error(`FAIL  ${flow.name} :: ${e.message.split('\n')[0]}`);
  }
}

console.log('');
if (failed.length) {
  console.error(`Fallaron ${failed.length}/${flows.length}: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`TODOS LOS FLUJOS OK (${flows.length} escenarios)`);
