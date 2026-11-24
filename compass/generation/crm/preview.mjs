import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateApplicationManifest} from '../manifest.mjs';

const scriptLimit = 1024 * 1024;
const styleLimit = 256 * 1024;
const safeTitle = {'&': '&amp;', '<': '&lt;', '>': '&gt;'};

function cspHash(text) {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
}

async function readAsset(filename, maxBytes, forbiddenMarkup) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || !info.size || info.size > maxBytes) throw Error('Invalid asset size or type.');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size) throw Error('Asset changed while reading.');
    // HTML parsers normalize line endings inside raw text elements too.
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length)).replace(/\r\n?/g, '\n');
    if (!text.trim() || text.includes('\0') || forbiddenMarkup.test(text)) throw Error('Unsafe preview asset.');
    return text;
  } finally {
    await file.close();
  }
}

function inertJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// A renderer is scoped to one static root. Only trusted build output is loaded;
// the manifest contributes text data, never script, styles, markup or URLs.
export function createCrmPreviewRenderer(staticRoot) {
  const folder = resolve(staticRoot, 'internal-crm');
  let assets;
  function load() {
    assets ||= Promise.all([
      readAsset(resolve(folder, 'crm.js'), scriptLimit, /<\/script|<!--/i),
      readAsset(resolve(folder, 'crm.css'), styleLimit, /<\/style/i),
    ]).then(([script, style]) => ({script, style, scriptHash: cspHash(script), styleHash: cspHash(style)})).catch(cause => {
      assets = undefined;
      throw Object.assign(new Error('CRM preview build unavailable.', {cause}), {status: 503, code: 'crm_preview_unavailable'});
    });
    return assets;
  }

  return {
    async scriptHash() { return (await load()).scriptHash; },
    async render(value) {
      const manifest = validateApplicationManifest(value);
      if (!manifest?.crm) throw Object.assign(new Error('Invalid CRM manifest.'), {status: 400, code: 'invalid_manifest'});
      const {script, style, scriptHash, styleHash} = await load();
      const policy = ["default-src 'none'", `script-src ${scriptHash}`, `style-src ${styleHash}`,
        "connect-src 'none'", "img-src data:", "font-src 'none'", "object-src 'none'", "frame-src 'none'",
        "worker-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
      const {title, description, theme, crm} = manifest;
      const pageTitle = title.replace(/[&<>]/g, character => safeTitle[character]);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${pageTitle}</title><style>${style}</style></head><body><div id="crm-root"></div><script type="application/json" id="crm-manifest">${inertJson({title, description, theme, crm})}</script><script>${script}</script></body></html>`;
    },
  };
}
