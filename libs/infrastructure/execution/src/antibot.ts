/**
 * Detección de anti-bot (E, bloque 1). Pura: reconoce páginas de challenge
 * (Cloudflare interstitial, reCAPTCHA, hCaptcha) por marcadores en el HTML.
 * Solo 'cloudflare' es bloqueante; los captchas se tratan como aviso + render.
 */

export type ChallengeKind = 'cloudflare' | 'recaptcha' | 'hcaptcha';

const CLOUDFLARE = /Just a moment\.\.\.|Attention Required!\s*\|\s*Cloudflare|__cf_chl|cf-chl-/i;
const RECAPTCHA = /g-recaptcha|google\.com\/recaptcha/i;
const HCAPTCHA = /hcaptcha\.com|h-captcha/i;

export function detectChallenge(html: string): ChallengeKind | null {
  if (!html) return null;
  if (CLOUDFLARE.test(html)) return 'cloudflare';
  if (RECAPTCHA.test(html)) return 'recaptcha';
  if (HCAPTCHA.test(html)) return 'hcaptcha';
  return null;
}
