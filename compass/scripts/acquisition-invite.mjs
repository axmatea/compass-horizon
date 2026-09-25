import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { createAuth, normalizeInviteEmail } from '../server/acquisition/auth.mjs';

/** Operator-only helper. Never call this from a public HTTP endpoint. */
export async function createInvite({ pool, email, expiresInHours = 72 }) {
  email = normalizeInviteEmail(email);
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) throw new Error('Expiry must be an integer from 1 to 168 hours.');
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  const result = await pool.query(`INSERT INTO acq_invites (id, token_hash, email, expires_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP + $4 * INTERVAL '1 hour')
    RETURNING id, email, expires_at`, [randomUUID(), digest, email, expiresInHours]);
  return { id: result.rows[0].id, email, token, expiresAt: result.rows[0].expires_at };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const usage = 'Usage: node scripts/acquisition-invite.mjs --email ADDRESS [--expires-hours 72] --confirm-create';
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\nRequires DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET. Creates no account or workspace.\n`);
    return;
  }
  let email;
  let expiresInHours = 72;
  let approved = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (flag === '--confirm-create') approved = true;
    else if (flag === '--email') email = args[++index];
    else if (flag === '--expires-hours') expiresInHours = Number(args[++index]);
    else throw new Error(usage);
  }
  if (!approved || !email) throw new Error(usage);
  email = normalizeInviteEmail(email);
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) throw new Error('Expiry must be an integer from 1 to 168 hours.');
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || '')) throw new Error('DATABASE_URL must be configured for PostgreSQL.');
  const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000, max: 2 });
  try {
    await createAuth({ pool, env });
    const invite = await createInvite({ pool, email, expiresInHours });
    process.stdout.write(`${JSON.stringify(invite)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never print pg errors, connection strings, or environment values.
    process.stderr.write('Invite creation failed. Check --help, explicit confirmation, configuration, and database availability.\n');
    process.exitCode = 1;
  });
}
