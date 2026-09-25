const MESSAGES = Object.freeze({
  PROVIDER_BLOCKED: 'Provider configuration is missing or invalid.',
  INVALID_INPUT: 'Provider input is invalid.',
  PROVIDER_TIMEOUT: 'Provider request timed out; completion is unknown.',
  PROVIDER_NETWORK: 'Provider connection failed; completion is unknown.',
  PROVIDER_HTTP: 'Provider rejected the request.',
  INVALID_RESPONSE: 'Provider returned an invalid response.',
  RESPONSE_TOO_LARGE: 'Provider response exceeded the size limit.',
  MODEL_UNAVAILABLE: 'Configured Liquid model is unavailable on this host.',
  STRUCTURED_OUTPUT_UNAVAILABLE: 'Configured Liquid model does not advertise structured outputs.',
  INGEST_NOT_ACKNOWLEDGED: 'Tinybird did not acknowledge every row.',
});

export class ProviderError extends Error {
  constructor(code, { httpStatus } = {}) {
    super(MESSAGES[code] ?? MESSAGES.INVALID_RESPONSE);
    this.name = 'ProviderError';
    const reasonCode = Object.hasOwn(MESSAGES, code) ? code : 'INVALID_RESPONSE';
    this.status = ['PROVIDER_BLOCKED', 'MODEL_UNAVAILABLE', 'STRUCTURED_OUTPUT_UNAVAILABLE'].includes(reasonCode)
      ? 'BLOCKED' : 'FAILED';
    this.code = this.status === 'BLOCKED' ? 'BLOCKED' : reasonCode;
    this.reasonCode = reasonCode;
    if (Number.isInteger(httpStatus)) this.httpStatus = httpStatus;
  }
}

export function requireValid(condition, code = 'INVALID_RESPONSE') {
  if (!condition) throw new ProviderError(code);
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function boundedText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function createHttp(fetchImpl, timeoutMs) {
  return async function request(url, { token, authScheme = 'Bearer', method = 'GET', body, contentType = 'application/json', expectedStatus = 200 }) {
    const controller = new AbortController();
    let timer;
    let reader;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError('PROVIDER_TIMEOUT'));
        controller.abort();
        reader?.cancel().catch(() => {});
      }, timeoutMs);
    });
    const operation = async () => {
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `${authScheme} ${token}`;
      if (body !== undefined) headers['Content-Type'] = contentType;
      const response = await fetchImpl(url.toString(), {
        method, headers, body, signal: controller.signal, redirect: 'error',
      });
      if (response.status !== expectedStatus) {
        response.body?.cancel().catch(() => {});
        throw new ProviderError('PROVIDER_HTTP', { httpStatus: response.status });
      }
      const maxBytes = 4 * 1024 * 1024;
      const declaredSize = Number(response.headers.get('content-length'));
      requireValid(response.body);
      reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        requireValid(!Number.isFinite(declaredSize) || declaredSize <= maxBytes, 'RESPONSE_TOO_LARGE');
        requireValid(/\bjson\b/i.test(response.headers.get('content-type') ?? ''));
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          requireValid(size <= maxBytes, 'RESPONSE_TOO_LARGE');
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } finally {
        reader.cancel().catch(() => {});
      }
    };
    try {
      return await Promise.race([operation(), timeout]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // Never retain response bodies, URLs, credentials, or the original error/cause.
      throw new ProviderError(error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'PROVIDER_NETWORK');
    } finally {
      clearTimeout(timer);
      controller.abort();
      reader?.cancel().catch(() => {});
    }
  };
}
