import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const {
  createSiteRadiographyUseCases,
  SiteProfileNotFoundError,
  SiteRadiographyNotFoundError,
} = await import('../libs/application/execution/dist/index.js');

function setup(overrides = {}) {
  const calls = { perform: [], learned: [], fresh: [], stats: [] };
  const knowledge = {
    async perform(url, options) {
      calls.perform.push({ url, options });
      return { profile: { id: 'profile-1' }, discovered: [{ selector: '.card' }], radiography: { url } };
    },
    async findProfile(domain) {
      return domain === 'shop.com' ? { domain } : null;
    },
    async getLearnedProfile(url) {
      calls.learned.push(url);
      return { profile: { domain: 'shop.com' }, shouldUseBrowser: true, recommendedSelectors: { list: ['.card'] } };
    },
    async findFreshRadiography(target, maxAgeHours) {
      calls.fresh.push({ target, maxAgeHours });
      return target === 'https://shop.com/' ? { url: target } : null;
    },
    async getDomainStats(domain) {
      calls.stats.push(domain);
      return { domain, totalJobs: 1 };
    },
    ...overrides,
  };
  return { calls, useCases: createSiteRadiographyUseCases({ knowledge }) };
}

describe('F8 — casos de uso de radiografía/memoria de sitios', () => {
  it('create normaliza el dominio y proyecta el resultado', async () => {
    const { calls, useCases } = setup();
    const result = await useCases.create({ url: 'https://www.shop.com/x', maxDepth: 2, forceBrowser: true });

    assert.equal(result.domain, 'shop.com');
    assert.equal(result.profileId, 'profile-1');
    assert.deepEqual(result.discovered, [{ selector: '.card' }]);
    assert.deepEqual(result.radiography, { url: 'https://www.shop.com/x' });
    assert.deepEqual(calls.perform[0].options, { maxDepth: 2, maxPages: undefined, forceBrowser: true });
  });

  it('getProfile traduce ausencia a SiteProfileNotFoundError', async () => {
    const { useCases } = setup();
    assert.deepEqual(await useCases.getProfile('shop.com'), { domain: 'shop.com' });
    await assert.rejects(() => useCases.getProfile('other.com'), SiteProfileNotFoundError);
  });

  it('selectores y stats pasan por el puerto', async () => {
    const { calls, useCases } = setup();
    const learned = await useCases.getSelectors('shop.com');
    assert.equal(learned.shouldUseBrowser, true);
    assert.deepEqual(calls.learned, ['https://shop.com']);
    assert.deepEqual(await useCases.getDomainStats('shop.com'), { domain: 'shop.com', totalJobs: 1 });
    assert.deepEqual(calls.stats, ['shop.com']);
  });

  it('getPageRadiography aplica expiración y lanza si no hay documento', async () => {
    const { calls, useCases } = setup();
    assert.deepEqual(await useCases.getPageRadiography('https://shop.com/', 12), { url: 'https://shop.com/' });
    assert.deepEqual(calls.fresh[0], { target: 'https://shop.com/', maxAgeHours: 12 });
    await assert.rejects(() => useCases.getPageRadiography('https://otro.com/', 1), SiteRadiographyNotFoundError);
  });
});
