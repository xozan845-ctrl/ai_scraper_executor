# @ai-scraper/infrastructure-webhooks

Adaptador HTTP del puerto `WebhookNotifier` de `application/scraper`.

- **Capa**: infraestructura.
- **Dependencias**: `@ai-scraper/application-scraper` (puerto) y
  `@ai-scraper/shared-security` (`safePostJson`: SSRF + IP fijada, sin redirects).
- **Superficie pública**:
  - `HttpWebhookNotifier` — POST JSON firmado con HMAC-SHA256 (`X-Webhook-Signature:
    sha256=<hex>`), timeout, 3 intentos con backoff exponencial y sin redirects.
  - `WebhookNotifierOptions` — secreto, timeout, intentos, backoff y política de
    hosts privados (solo dev/tests).

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-webhooks
MONGODB_MOCK=1 npm test
```
