import {createHash,randomUUID} from 'node:crypto';
import {createApplicationBundle} from '../generation/index.mjs';

export const SANDBOX_LIMITS = Object.freeze({vcpus:1,memoryMB:2048,timeoutMs:120000,commandTimeoutMs:45000,network:'deny-all',persistent:false,ports:[]});
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function sandboxConfiguration(env = {}) {
  if (env.COMPASS_SANDBOX_MODE !== 'vercel' || env.COMPASS_SANDBOX_SPEND_APPROVED !== 'true') return {configured:false,reason:'isolated_provider_not_authorized'};
  if (!env.VERCEL_TOKEN || !env.VERCEL_TEAM_ID || !env.VERCEL_PROJECT_ID) return {configured:false,reason:'isolated_provider_credentials_missing'};
  if (typeof env.COMPASS_SANDBOX_IMAGE !== 'string' || !/^[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(env.COMPASS_SANDBOX_IMAGE)) return {configured:false,reason:'pinned_prebuilt_image_required'};
  return {configured:true};
}

// Optional external verification. This adapter never uses a host shell, eval,
// vm2, child_process, user-supplied commands or generated JavaScript. All code
// is reconstructed from the trusted template and compared before upload.
export function createIsolatedVerifier({env = {},loadSdk = () => import('@vercel/sandbox'),now = Date.now} = {}) {
  let active = 0;
  return {
    status:() => sandboxConfiguration(env),
    async verify({ownerId,projectId,bundle,authorizedOwnerId}) {
      if (!identity(ownerId) || ownerId !== authorizedOwnerId || !identity(projectId)) throw Object.assign(new Error('Owner authorization required.'),{status:403,code:'owner_required'});
      const configuration = sandboxConfiguration(env);
      if (!configuration.configured) return {status:'blocked',provider:'vercel-sandbox',reason:configuration.reason};
      if (active >= 2) throw Object.assign(new Error('Verification capacity reached.'),{status:429,code:'sandbox_capacity'});
      active++;
      let canonical;
      try {
        canonical = await createApplicationBundle(bundle?.manifest);
        if (bundle?.sha256 !== canonical.sha256 || JSON.stringify(bundle.files) !== JSON.stringify(canonical.files)) throw Object.assign(new Error('Only trusted application templates may run.'),{status:400,code:'untrusted_source'});
      } catch(error) {active--;throw error;}
      const startedAt = now(), scope = createHash('sha256').update(ownerId + ':' + projectId).digest('hex').slice(0,18);
      const receipt = {schema:1,provider:'vercel-sandbox',ownerId,projectId,bundleSha256:canonical.sha256,startedAt:new Date(startedAt).toISOString(),expiresAt:new Date(startedAt + SANDBOX_LIMITS.timeoutMs).toISOString(),status:'failed',checks:[],limits:SANDBOX_LIMITS};
      let sandbox;
      try {
        const {Sandbox} = await loadSdk();
        sandbox = await Sandbox.create({token:env.VERCEL_TOKEN,teamId:env.VERCEL_TEAM_ID,projectId:env.VERCEL_PROJECT_ID,
          name:`compass-${scope}-${randomUUID().slice(0,8)}`,image:env.COMPASS_SANDBOX_IMAGE,
          resources:{vcpus:SANDBOX_LIMITS.vcpus},timeout:SANDBOX_LIMITS.timeoutMs,networkPolicy:'deny-all',persistent:false,ports:[],tags:{compassProject:projectId,ownerScope:scope}});
        receipt.providerName = sandbox.name;
        receipt.providerSessionId = sandbox.currentSession().sessionId;
        if (!receipt.providerName || !receipt.providerSessionId) throw Error('Missing provider receipt.');
        for (const directory of ['lib','public','test']) await sandbox.mkDir('/vercel/sandbox/' + directory);
        await sandbox.writeFiles(canonical.files.map(file => ({path:'/vercel/sandbox/' + file.path,content:Buffer.from(file.content),mode:0o600})));
        // The immutable image must contain the pinned npm dependencies already.
        // Egress stays denied; no npm install, repository checkout or secrets
        // are sent to the VM. Its own test generates disposable local secrets.
        for (const [name,args] of [['syntax',['--check','server.mjs']],['application-tests',['--test','test/smoke.test.mjs']]]) {
          const result = await sandbox.runCommand({cmd:'node',args,cwd:'/vercel/sandbox',timeoutMs:SANDBOX_LIMITS.commandTimeoutMs});
          receipt.checks.push({name,commandId:result.cmdId || null,exitCode:result.exitCode});
          if (!result.cmdId || result.exitCode !== 0) throw Error('Verification failed.');
        }
        receipt.status = 'verified';
      } catch { receipt.reason = 'provider_verification_failed'; }
      finally {
        if (sandbox) {
          try {await sandbox.stop();receipt.stopped = true;}
          catch {receipt.stopped = false;receipt.status = 'failed';receipt.reason = 'provider_stop_failed';}
        }
        receipt.finishedAt = new Date(now()).toISOString();
        active--;
      }
      return receipt;
    },
  };
}
