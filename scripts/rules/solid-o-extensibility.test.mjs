// SOLID · OCP (Open/Closed): las reglas de acceso se extienden por decoradores/guards,
// no por condicionales de tipo/rol en la lógica interna. La decisión de autorización
// (leer API key, comparar el token de bootstrap) vive solo en `*.guard.ts`.
import { describe, it } from 'vitest';
import { collectSourceFiles, readSource, stripComments, toRel, assertClean } from './_shared.mjs';

const RULE = 'OCP';
// Señales de CÓDIGO de una decisión de acceso (no textos de Swagger ni comentarios):
// helpers de auth y lectura de secretos de entorno.
const AUTH_PRIMITIVE = /\btimingSafeEqual\b|\bapiKeyScope\b|\bisAuthEnforced\b|\bprocess\.env\.(?:API_KEYS|FIRST_RUN_TOKEN)\b/;

function scan() {
  const out = new Map();
  const files = collectSourceFiles(
    ['apps/api/src'],
    (p) => p.endsWith('.controller.ts') || p.endsWith('.service.ts'),
  );
  for (const file of files) {
    const rel = toRel(file);
    stripComments(readSource(file)).split('\n').forEach((line, idx) => {
      const match = AUTH_PRIMITIVE.exec(line);
      if (match && !out.has(rel)) {
        out.set(rel, { file: rel, line: idx + 1, detail: `decisión de acceso '${match[0]}' fuera de un *.guard.ts (usa guard/decorador)` });
      }
    });
  }
  return [...out.values()];
}

describe('SOLID-OCP · reglas de acceso extensibles por guards', () => {
  it('la lógica de autorización vive solo en guards', () => {
    assertClean(RULE, scan());
  });
});
