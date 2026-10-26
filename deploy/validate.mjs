import { Buffer } from 'node:buffer';
import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';

const file = resolve(process.argv[2] || 'deploy/.env.production');
const values = {};
let failures = 0;
const fail = (message) => {
  failures += 1;
  process.stderr.write(`✗ ${message}\n`);
};
const pass = (message) => process.stdout.write(`✓ ${message}\n`);
try {
  const text = await readFile(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_]+)=(.*)$/);
    if (!match) {
      fail('Environment file must use plain KEY=value lines.');
      continue;
    }
    if (Object.hasOwn(values, match[1])) fail(`Duplicate variable: ${match[1]}`);
    values[match[1]] = match[2];
  }
} catch {
  fail('Cannot read deployment environment file. Copy production.env.example first.');
}

for (const key of ['APP_ORIGIN', 'ADMIN_ORIGIN']) {
  try {
    const url = new URL(values[key]);
    if (
      url.protocol !== 'https:' ||
      url.origin !== values[key] ||
      url.username ||
      /(^|\.)example\.(com|org|net)$/.test(url.hostname) ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      throw new Error();
    }
    pass(`${key} is an explicit production HTTPS origin.`);
  } catch {
    fail(`${key} requires your actual HTTPS origin, without path or trailing slash.`);
  }
}
if (values.APP_ORIGIN === values.ADMIN_ORIGIN) {
  fail('Use separate app/admin origins because both SPAs are served from /.');
}
for (const key of ['FRONTEND_PORT', 'ADMIN_PORT']) {
  const port = Number(values[key]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail(`${key} must be an unprivileged host port (1024–65535).`);
  }
}
if (values.FRONTEND_PORT === values.ADMIN_PORT) fail('App/admin host ports must differ.');

const databaseSecrets = new Set();
for (const key of [
  'POSTGRES_ADMIN_PASSWORD_FILE',
  'POSTGRES_PASSWORD_FILE',
  'BOOTSTRAP_ADMIN_PASSWORD_FILE',
]) {
  try {
    if (!isAbsolute(values[key] || '')) throw new Error();
    const info = await stat(values[key]);
    if (!info.isFile()) throw new Error();
    // Compose mounts file-backed secrets with host ownership/mode; the API runs
    // as UID 65532. A locked parent directory + 0444 file is the portable setup.
    if ((info.mode & 0o004) === 0 || (info.mode & 0o022) !== 0) {
      fail(`${key}: use mode 0444 inside a host directory with mode 0700.`);
    }
    const parent = await stat(dirname(values[key]));
    if ((parent.mode & 0o077) !== 0) fail(`${key}: secret parent directory must use mode 0700.`);
    const secret = (await readFile(values[key], 'utf8')).trimEnd();
    if (key.startsWith('POSTGRES_')) {
      if (databaseSecrets.has(secret))
        fail('Database administrator and application secrets must differ.');
      databaseSecrets.add(secret);
    }
    if (key.startsWith('POSTGRES_') && !/^[a-fA-F0-9]{64}$/.test(secret)) {
      fail('Database secret must be a fresh 64-character hexadecimal value.');
    }
    if (
      key === 'BOOTSTRAP_ADMIN_PASSWORD_FILE' &&
      (values.BOOTSTRAP_ADMIN_EMAIL || values.BOOTSTRAP_ADMIN_HANDLE) &&
      (Buffer.byteLength(secret) < 16 || Buffer.byteLength(secret) > 72)
    ) {
      fail('Bootstrap secret requires 16–72 bytes.');
    }
    if (['gongming_dev', 'Demo2026!', 'Admin2026!'].includes(secret)) {
      fail(`${key}: development credentials are forbidden.`);
    }
    pass(`${key} exists; contents are not printed.`);
  } catch {
    fail(`${key} must name an existing absolute secret file path.`);
  }
}
if (!!values.BOOTSTRAP_ADMIN_EMAIL !== !!values.BOOTSTRAP_ADMIN_HANDLE) {
  fail('Set or clear both bootstrap email and handle together.');
}
if (values.BOOTSTRAP_ADMIN_EMAIL) {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.BOOTSTRAP_ADMIN_EMAIL) ||
    /@(gongming\.local|example\.(com|org|net))$/.test(values.BOOTSTRAP_ADMIN_EMAIL)
  ) {
    fail('Bootstrap email must be your real operator email.');
  }
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(values.BOOTSTRAP_ADMIN_HANDLE || '')) {
    fail('Bootstrap handle must use 3–30 lowercase letters/digits/underscores.');
  }
}
if (failures) {
  process.stderr.write(`${failures} deployment preflight check(s) failed.\n`);
  process.exitCode = 1;
} else {
  pass('Environment/secret preflight passed. Docker build/runtime remain separate checks.');
}
