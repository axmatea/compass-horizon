function value(env, name) {
  return typeof env[name] === 'string' ? env[name].trim() : '';
}

function tokenValid(token) {
  return token.length > 0 && token.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(token);
}

function endpoint(raw, allowLocal = false) {
  try {
    if (/[?#]/.test(raw)) return null;
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(allowLocal && loopback && url.protocol === 'http:')) return null;
    return { base: url.href.replace(/\/+$/, ''), loopback, url };
  } catch { return null; }
}

export function readConfig(env) {
  const timeout = value(env, 'ACQUISITION_PROVIDER_TIMEOUT_MS') || '20000';
  const timeoutMs = Number(timeout);
  const timingValid = /^\d+$/.test(timeout) && Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120000;
  const nimbleKey = value(env, 'NIMBLE_API_KEY');
  const liquidEndpoint = endpoint(value(env, 'LIQUID_BASE_URL'), value(env, 'LIQUID_ALLOW_LOCAL_HTTP') === 'true');
  const liquidKey = value(env, 'LIQUID_API_KEY');
  const liquidModel = value(env, 'LIQUID_MODEL');
  const liquidScheme = value(env, 'LIQUID_AUTH_SCHEME') || 'Bearer';
  const modelValid = /^(?:LiquidAI\/LFM[\w.-]+|liquid\/lfm[\w.:-]+)$/.test(liquidModel) && liquidModel.length <= 150;
  const isOpenRouter = liquidEndpoint?.base === 'https://openrouter.ai/api/v1';
  const authValid = ['Bearer', 'Key'].includes(liquidScheme) ? tokenValid(liquidKey)
    : liquidScheme === 'none' && liquidEndpoint?.loopback;
  const liquidValid = liquidEndpoint && /\/v1$/.test(liquidEndpoint.base) && modelValid && authValid
    && (!isOpenRouter || (liquidScheme === 'Bearer' && liquidModel.startsWith('liquid/')));
  const tinybirdEndpoint = endpoint(value(env, 'TINYBIRD_HOST'));
  const tinybirdValidHost = tinybirdEndpoint && tinybirdEndpoint.url.pathname === '/'
    && /^(?:api\.)?[a-z0-9.-]*tinybird\.co$/.test(tinybirdEndpoint.url.hostname)
    && (tinybirdEndpoint.url.hostname === 'api.tinybird.co' || tinybirdEndpoint.url.hostname.endsWith('.tinybird.co'))
    && !tinybirdEndpoint.url.port;
  const appendToken = value(env, 'TINYBIRD_APPEND_TOKEN');
  const readToken = value(env, 'TINYBIRD_READ_TOKEN');
  const hashKey = value(env, 'TINYBIRD_HASH_KEY');
  const datasource = value(env, 'TINYBIRD_DATASOURCE') || 'acquisition_lead_versions';
  return {
    timeoutMs: timingValid ? timeoutMs : 20000,
    nimble: {
      name: 'Nimble', operation: 'research', token: nimbleKey,
      reason: !timingValid ? 'Invalid ACQUISITION_PROVIDER_TIMEOUT_MS.' : !tokenValid(nimbleKey) ? 'Set NIMBLE_API_KEY.' : null,
    },
    liquid: {
      name: 'Liquid AI', operation: 'extract', base: liquidEndpoint?.base, token: liquidScheme === 'none' ? '' : liquidKey,
      authScheme: liquidScheme, model: modelValid ? liquidModel : undefined, isOpenRouter,
      reason: !timingValid ? 'Invalid ACQUISITION_PROVIDER_TIMEOUT_MS.' : !liquidValid
        ? 'Set a valid LIQUID_BASE_URL, LIQUID_MODEL and LIQUID_API_KEY/auth configuration.' : null,
    },
    tinybird: {
      name: 'Tinybird', operation: 'metrics', base: tinybirdEndpoint?.base, appendToken, readToken, hashKey, datasource,
      reason: !timingValid ? 'Invalid ACQUISITION_PROVIDER_TIMEOUT_MS.'
        : !tinybirdValidHost || !tokenValid(appendToken) || !tokenValid(readToken) || hashKey.length < 32
          || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(datasource)
          ? 'Set TINYBIRD_HOST, TINYBIRD_APPEND_TOKEN, TINYBIRD_READ_TOKEN, TINYBIRD_HASH_KEY (32+ characters); validate TINYBIRD_DATASOURCE.' : null,
    },
  };
}
