// Where live rates come from, tried in order until one returns a number.
//
// Frankfurter was the original source and is last here on purpose: it serves
// European Central Bank reference rates, which cover ~30 major currencies and
// include neither AED nor PKR, so it can never answer the pair this app was
// built for. The two ahead of it cover 150+ currencies and need no API key.

const PER_PROVIDER_TIMEOUT_MS = 2500;

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PER_PROVIDER_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const PROVIDERS = [
  {
    name: 'open.er-api.com',
    async fetchRate(base, target) {
      const data = await getJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
      if (data.result && data.result !== 'success') {
        throw new Error(data['error-type'] || 'provider reported failure');
      }
      return data.rates?.[target];
    },
  },
  {
    // Static JSON on a CDN — no rate limits and nothing to sign up for.
    name: 'currency-api',
    async fetchRate(base, target) {
      const b = base.toLowerCase();
      const t = target.toLowerCase();
      try {
        const data = await getJson(
          `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${b}.json`
        );
        return data[b]?.[t];
      } catch (err) {
        const data = await getJson(`https://latest.currency-api.pages.dev/v1/currencies/${b}.json`);
        return data[b]?.[t];
      }
    },
  },
  {
    name: 'frankfurter (ECB majors only)',
    async fetchRate(base, target) {
      const data = await getJson(
        `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(target)}`
      );
      return data.rates?.[target];
    },
  },
];

// Returns { rate, provider } from the first provider that answers, or throws
// with every provider's failure attached so the cause is visible.
async function fetchRate(base, target) {
  const failures = [];
  for (const provider of PROVIDERS) {
    try {
      const rate = await provider.fetchRate(base, target);
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        return { rate, provider: provider.name };
      }
      failures.push(`${provider.name}: no rate for ${base}->${target}`);
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timed out' : err.message;
      failures.push(`${provider.name}: ${reason}`);
    }
  }
  const error = new Error(`No provider had ${base}->${target}. ${failures.join('; ')}`);
  error.failures = failures;
  throw error;
}

// Same walk, but reports what every provider did instead of stopping early.
async function diagnose(base, target) {
  return Promise.all(
    PROVIDERS.map(async (provider) => {
      const startedAt = Date.now();
      try {
        const rate = await provider.fetchRate(base, target);
        const ms = Date.now() - startedAt;
        if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
          return { provider: provider.name, ok: true, rate, ms };
        }
        return { provider: provider.name, ok: false, ms, reason: `doesn't cover ${base}->${target}` };
      } catch (err) {
        return {
          provider: provider.name,
          ok: false,
          ms: Date.now() - startedAt,
          reason: err.name === 'TimeoutError' ? 'timed out' : err.message,
        };
      }
    })
  );
}

module.exports = { fetchRate, diagnose, PROVIDERS, PER_PROVIDER_TIMEOUT_MS };
