// Explicitly enabled browser-test fixture. Never import this in a real provider session.
if (process.env.VIRAL_HIT_SUME_TEST_FIXTURE !== '1') throw Error('Sume balance fixture requires explicit test mode');
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://api.sume.com/v1/open/balance') {
    return new Headers(options?.headers).get('authorization') === 'Bearer fixture-ui-key'
      ? Response.json({ data: { balance: 0 } })
      : Response.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  return original(url, options);
};
