import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  apiProbeTargets,
  backupMedia,
  checkedDirectory,
  copyVerifiedFile,
  fileDigest,
  localEnvironment,
  mediaFilename,
  normalizeAssets,
  openSnapshot,
  requireOffline,
  restoreCheckMedia,
  toolRunner,
  validateBundle,
  validateManifest,
} from './media-backup.mjs';

const uri = 'postgres://gongming:PRIVATE_PASSWORD@127.0.0.1:55432/gongming?sslmode=disable';
const png = Buffer.from('normalized PNG bytes');
const jpeg = Buffer.from('normalized JPEG bytes');
const dump = Buffer.from('PGDMP test fixture; never passed to real PostgreSQL');
const rows = [
  { id: 'media_' + 'a'.repeat(32), contentType: 'image/png', bytes: png.length, deletedAt: null },
  { id: 'media_' + 'b'.repeat(32), contentType: 'image/jpeg', bytes: jpeg.length, deletedAt: null },
  {
    id: 'media_' + 'c'.repeat(32),
    contentType: 'image/png',
    bytes: 5,
    deletedAt: '2026-10-27T03:00:00.000000Z',
  },
];
const sha = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), 'gongming-media-backup-test-'));
  chmodSync(workspace, 0o700);
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, '.runtime', 'media');
  mkdirSync(source, { recursive: true, mode: 0o700 });
  writeFileSync(join(source, mediaFilename(rows[0])), png, { mode: 0o600 });
  writeFileSync(join(source, mediaFilename(rows[1])), jpeg, { mode: 0o600 });
  // Tombstones can leave ordinary orphan files; these are not active backups.
  writeFileSync(join(source, mediaFilename(rows[2])), 'old!!', { mode: 0o600 });
  const environment = {
    ...process.env,
    APP_ENV: 'development',
    DATABASE_URL: uri,
    MEDIA_DIRECTORY: source,
  };
  const calls = [];
  let snapshotOpen = false;
  const controls = {
    sourceRows: rows,
    restoredRows: rows,
    fail: '',
    afterDump: () => {},
    inspectRestore: () => {},
  };
  const run = (program, args, options = {}) => {
    calls.push({ program, args, options });
    if (controls.fail === program) throw new Error('injected tool failure');
    if (program === 'pg_dump') {
      assert.equal(snapshotOpen, true, 'database export transaction must remain alive');
      assert.ok(args.includes('--snapshot=00000003-0000001B-1'));
      writeSync(options.stdoutFd, dump);
      controls.afterDump();
    } else if (program === 'psql') {
      assert.ok(args.includes('-X'), 'ignore user psql startup scripts');
      return JSON.stringify(options.database ? controls.restoredRows : controls.sourceRows);
    } else if (program === 'pg_restore') {
      controls.inspectRestore(args, options);
    }
    return '';
  };
  const snapshot = async () => {
    snapshotOpen = true;
    return {
      snapshot: '00000003-0000001B-1',
      assets: rows,
      close: async () => {
        snapshotOpen = false;
      },
    };
  };
  const options = {
    workspace,
    environment,
    writersStopped: true,
    probe: async () => false,
    run,
    snapshot,
  };
  return {
    workspace,
    source,
    environment,
    calls,
    controls,
    options,
    snapshotOpen: () => snapshotOpen,
  };
}
function bundleDirectories(f) {
  const base = join(f.workspace, '.runtime', 'backups');
  return existsSync(base) ? readdirSync(base) : [];
}
function changeManifest(directory, mutate) {
  const path = join(directory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  mutate(manifest);
  writeFileSync(path, JSON.stringify(manifest), { mode: 0o600 });
}

test('only explicit development, pinned loopback project PostgreSQL, and offline consent are accepted', async (t) => {
  const f = fixture(t);
  const env = localEnvironment({
    ...f.environment,
    PGHOSTADDR: '203.0.113.10',
    PGSERVICE: 'production',
    PGSERVICEFILE: '/secret/service',
    PGOPTIONS: '-c search_path=other',
  });
  assert.equal(env.PGHOSTADDR, '127.0.0.1');
  assert.equal(env.PGPORT, '55432');
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.PGSERVICEFILE, undefined);
  assert.equal(env.PGOPTIONS, undefined);
  for (const environment of [
    { ...f.environment, APP_ENV: 'production' },
    { ...f.environment, APP_ENV: '' },
    { ...f.environment, DATABASE_URL: uri.replace('127.0.0.1', 'db.example.test') },
    { ...f.environment, DATABASE_URL: uri.replace('55432', '5432') },
    { ...f.environment, DATABASE_URL: uri + '&hostaddr=203.0.113.10' },
    { ...f.environment, DATABASE_URL: uri.replace('/gongming?', '/host%3D203.0.113.10?') },
  ])
    await assert.rejects(backupMedia({ ...f.options, environment }));
  await assert.rejects(backupMedia({ ...f.options, writersStopped: false }), /--writers-stopped/);
  for (const address of [
    'db.example.test:8080',
    '127.0.0.1:0',
    '127.0.0.1:99999',
    'http://localhost:8080',
  ])
    assert.throws(() => apiProbeTargets(address));
  assert.deepEqual(
    apiProbeTargets('0.0.0.0:8080').map((value) => value.host),
    ['127.0.0.1', '::1'],
  );
  assert.equal(f.calls.length, 0);
  assert.equal(bundleDirectories(f).length, 0);
});

test('an actually listening local API refuses backup before invoking database tools', async (t) => {
  const f = fixture(t);
  const server = createServer((socket) => socket.end());
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
  t.after(() => new Promise((accept) => server.close(accept)));
  const address = server.address();
  await assert.rejects(
    requireOffline({ ...f.environment, API_ADDR: `127.0.0.1:${address.port}` }, true),
    /仍在监听/,
  );
  await assert.rejects(backupMedia({ ...f.options, probe: async () => true }), /仍在监听/);
  assert.equal(f.calls.length, 0);
});

test('media names are derived from bounded immutable metadata, never database paths', () => {
  assert.equal(mediaFilename(rows[0]), rows[0].id + '.png');
  assert.equal(mediaFilename(rows[1]), rows[1].id + '.jpg');
  for (const id of [
    '../outside',
    'media_' + 'A'.repeat(32),
    rows[0].id + '/extra',
    rows[0].id + '.png',
  ])
    assert.throws(() => mediaFilename({ ...rows[0], id }));
  for (const contentType of ['image/svg+xml', '../png', 'image/gif'])
    assert.throws(() => mediaFilename({ ...rows[0], contentType }));
  for (const bytes of [0, -1, 8388609, 1.5])
    assert.throws(() => normalizeAssets([{ ...rows[0], bytes }]));
  assert.throws(() => normalizeAssets([{ ...rows[0], path: '/etc/passwd' }]));
  assert.throws(() => normalizeAssets([rows[0], rows[0]]));
});

test('directory aliases, file symlinks, hard links, and existing destination links are rejected', async (t) => {
  const f = fixture(t);
  const alias = join(f.workspace, 'alias');
  symlinkSync(f.source, alias);
  assert.throws(() => checkedDirectory(alias));
  assert.throws(() => checkedDirectory(join(alias, 'child'), { create: true }));
  assert.equal(existsSync(join(f.source, 'child')), false);
  await assert.rejects(
    backupMedia({ ...f.options, environment: { ...f.environment, MEDIA_DIRECTORY: alias } }),
  );
  const source = join(f.source, mediaFilename(rows[0]));
  const link = join(f.source, 'media_' + 'd'.repeat(32) + '.png');
  symlinkSync(source, link);
  assert.throws(() => fileDigest(link));
  await assert.rejects(backupMedia(f.options), /软链/);
  rmSync(link);
  linkSync(source, link);
  assert.throws(() => fileDigest(source), /硬链接/);
  rmSync(link);
  symlinkSync(source, link);
  assert.throws(() => copyVerifiedFile(source, link, { bytes: rows[0].bytes }));
  assert.deepEqual(readFileSync(source), png);
});

test('backup exports one snapshot, excludes tombstone orphans, and writes private verified files', async (t) => {
  const f = fixture(t);
  const result = await backupMedia(f.options);
  assert.equal(result.files, 2);
  assert.equal(result.assets, 3);
  assert.equal(f.snapshotOpen(), false);
  const manifest = validateBundle(result.directory);
  assert.equal(manifest.database.sha256, sha(dump));
  assert.equal(manifest.files[0].sha256, sha(png));
  assert.deepEqual(manifest.assets, rows);
  assert.equal(readdirSync(join(result.directory, 'media')).length, 2);
  for (const path of [result.directory, join(result.directory, 'media'), dirname(result.directory)])
    assert.equal(lstatSync(path).mode & 0o777, 0o700);
  for (const path of [
    join(result.directory, 'manifest.json'),
    join(result.directory, 'database.dump'),
    ...manifest.files.map((file) => join(result.directory, 'media', file.filename)),
  ])
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
  const text = readFileSync(join(result.directory, 'manifest.json'), 'utf8');
  assert.equal(text.includes('PRIVATE_PASSWORD'), false);
  assert.equal(text.includes('PGPASSWORD'), false);
  assert.equal(text.includes(f.source), false);
});

test('filesystem roots and existing shared directories are rejected without changing their modes', async (t) => {
  assert.throws(() => checkedDirectory('/'), /非文件系统根/);
  const source = fixture(t);
  chmodSync(source.source, 0o755);
  await assert.rejects(backupMedia(source.options), /仅当前用户/);
  assert.equal(lstatSync(source.source).mode & 0o777, 0o755);
  assert.equal(source.calls.length, 0);
  const destination = fixture(t);
  const backups = join(destination.workspace, '.runtime', 'backups');
  mkdirSync(backups, { mode: 0o755 });
  chmodSync(backups, 0o755);
  await assert.rejects(backupMedia(destination.options), /仅当前用户/);
  assert.equal(lstatSync(backups).mode & 0o777, 0o755);
  assert.deepEqual(readdirSync(backups), []);
  assert.equal(destination.calls.length, 0);
});

test('missing files and metadata-size mismatches fail backup and remove only the new bundle', async (t) => {
  for (const scenario of ['missing', 'truncated']) {
    const f = fixture(t);
    const path = join(f.source, mediaFilename(rows[0]));
    if (scenario === 'missing') rmSync(path);
    else writeFileSync(path, 'truncated');
    await assert.rejects(backupMedia(f.options));
    assert.equal(bundleDirectories(f).length, 0);
    assert.equal(f.snapshotOpen(), false);
    assert.deepEqual(readFileSync(join(f.source, mediaFilename(rows[1]))), jpeg);
  }
});

test('backup rejects a growing asset set or changed directory instead of claiming offline consistency', async (t) => {
  const f = fixture(t);
  f.controls.sourceRows = [...rows, { ...rows[0], id: 'media_' + 'd'.repeat(32) }];
  await assert.rejects(backupMedia(f.options), /资产集合发生变化/);
  assert.equal(bundleDirectories(f).length, 0);
  const g = fixture(t);
  g.controls.afterDump = () =>
    writeFileSync(join(g.source, 'media_' + 'e'.repeat(32) + '.png'), png, { mode: 0o600 });
  await assert.rejects(backupMedia(g.options), /目录集合发生变化/);
  assert.equal(bundleDirectories(g).length, 0);
});

test('manifest path traversal, duplicate IDs, malformed hashes and missing active files are refused', async (t) => {
  const f = fixture(t);
  const result = await backupMedia(f.options);
  const manifest = validateBundle(result.directory);
  for (const mutate of [
    (value) => {
      value.database.filename = '../database.dump';
    },
    (value) => {
      value.files[0].filename = '../../outside.png';
    },
    (value) => {
      value.files[0].filename = '/etc/passwd';
    },
    (value) => {
      value.files[0].sha256 = [value.files[0].sha256];
    },
    (value) => {
      value.files.push(value.files[0]);
    },
    (value) => {
      value.files.pop();
    },
    (value) => {
      value.database.sha256 = 'NOT-A-HASH';
    },
  ]) {
    const changed = JSON.parse(JSON.stringify(manifest));
    mutate(changed);
    assert.throws(() => validateManifest(changed));
  }
});

test('same-size image tampering and dump tampering are detected before restore tools run', async (t) => {
  for (const kind of ['media', 'database']) {
    const f = fixture(t);
    const result = await backupMedia(f.options);
    const path =
      kind === 'media'
        ? join(result.directory, 'media', mediaFilename(rows[0]))
        : join(result.directory, 'database.dump');
    const altered = readFileSync(path);
    altered[0] ^= 0xff;
    writeFileSync(path, altered);
    const before = f.calls.length;
    await assert.rejects(restoreCheckMedia({ ...f.options, source: result.directory }), /SHA-256/);
    assert.equal(f.calls.length, before);
  }
});

test('bundle symlinks, unexpected nodes, world-readable files, and missing file entries are refused', async (t) => {
  for (const kind of ['symlink', 'extra', 'permission', 'missing']) {
    const f = fixture(t);
    const result = await backupMedia(f.options);
    const path = join(result.directory, 'media', mediaFilename(rows[0]));
    if (kind === 'symlink') {
      rmSync(path);
      symlinkSync(join(f.source, mediaFilename(rows[0])), path);
    }
    if (kind === 'extra')
      writeFileSync(join(result.directory, 'unexpected.txt'), 'extra', { mode: 0o600 });
    if (kind === 'permission') chmodSync(path, 0o644);
    if (kind === 'missing') rmSync(path);
    assert.throws(() => validateBundle(result.directory));
  }
});

test('restore-check stages private media, compares restored metadata, and drops only its new database', async (t) => {
  const f = fixture(t);
  const bundle = await backupMedia(f.options);
  let staged;
  f.controls.inspectRestore = (args, options) => {
    assert.match(options.database, /^gongming_media_check_[a-f0-9]{24}$/);
    assert.ok(args.includes('--single-transaction'));
    assert.ok(args.includes('--exit-on-error'));
    staged = dirname(args.at(-1));
    assert.notEqual(staged, bundle.directory);
    assert.deepEqual(readFileSync(join(staged, 'media', mediaFilename(rows[0]))), png);
    assert.equal(lstatSync(join(staged, 'media')).mode & 0o777, 0o700);
  };
  const result = await restoreCheckMedia({ ...f.options, source: bundle.directory });
  assert.deepEqual(result, { files: 2, assets: 3 });
  const created = f.calls.filter((call) => call.program === 'createdb');
  const dropped = f.calls.filter((call) => call.program === 'dropdb');
  assert.equal(created.length, 1);
  assert.equal(dropped.length, 1);
  assert.equal(created[0].args.at(-1), dropped[0].args.at(-1));
  assert.notEqual(dropped[0].args.at(-1), 'gongming');
  assert.equal(existsSync(staged), false);
  assert.equal(validateBundle(bundle.directory).files.length, 2);
  assert.deepEqual(readFileSync(join(f.source, mediaFilename(rows[0]))), png);
});

test('restore mismatch and restore failure clean their database; failed creation never drops a database', async (t) => {
  for (const kind of ['metadata', 'pg_restore', 'createdb', 'dropdb']) {
    const f = fixture(t);
    const bundle = await backupMedia(f.options);
    if (kind === 'metadata') f.controls.restoredRows = rows.slice(1);
    else f.controls.fail = kind;
    await assert.rejects(restoreCheckMedia({ ...f.options, source: bundle.directory }));
    const dropped = f.calls.filter((call) => call.program === 'dropdb');
    assert.equal(dropped.length, kind === 'createdb' ? 0 : 1);
    assert.deepEqual(bundleDirectories(f), [bundle.directory.split('/').at(-1)]);
    assert.equal(validateBundle(bundle.directory).files.length, 2);
  }
});

test('PostgreSQL process failures never forward credential-bearing stderr', () => {
  const run = toolRunner(
    localEnvironment({ ...process.env, APP_ENV: 'development', DATABASE_URL: uri }),
  );
  assert.throws(
    () =>
      run(process.execPath, [
        '-e',
        "console.error('PRIVATE_PASSWORD PRIVATE_ROW_CONTENT'); process.exit(2)",
      ]),
    (error) =>
      !error.message.includes('PRIVATE_PASSWORD') && !error.message.includes('PRIVATE_ROW_CONTENT'),
  );
});

test('exported snapshot process stays alive through the caller and closes its read-only transaction', async (t) => {
  const f = fixture(t);
  const bin = join(f.workspace, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  const script = `#!/usr/bin/env node
process.stdin.setEncoding('utf8');
let input='';
process.stdin.on('data',chunk=>{input+=chunk;if(input.includes('SELECT')&&!input.includes('REPLIED')){process.stdout.write(JSON.stringify({snapshot:'00000003-0000001B-1',assets:${JSON.stringify(rows)}})+'\\n');input+='REPLIED';}if(input.includes('ROLLBACK'))process.exit(0);});
`;
  writeFileSync(join(bin, 'psql'), script, { mode: 0o700 });
  const snapshot = await openSnapshot({
    ...localEnvironment(f.environment),
    PATH: bin + ':' + process.env.PATH,
  });
  assert.deepEqual(snapshot.assets, rows);
  assert.equal(snapshot.snapshot, '00000003-0000001B-1');
  await snapshot.close();
});

test('invalid snapshot output is rejected without exposing its private payload', async (t) => {
  const f = fixture(t);
  const bin = join(f.workspace, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(
    join(bin, 'psql'),
    "#!/usr/bin/env node\nprocess.stdout.write('PRIVATE_PASSWORD invalid snapshot\\n');setInterval(()=>{},1000);\n",
    { mode: 0o700 },
  );
  await assert.rejects(
    openSnapshot({ ...localEnvironment(f.environment), PATH: bin + ':' + process.env.PATH }),
    (error) => !error.message.includes('PRIVATE_PASSWORD'),
  );
});

test('rewritten manifest sizes cannot hide a missing active image', async (t) => {
  const f = fixture(t);
  const result = await backupMedia(f.options);
  changeManifest(result.directory, (manifest) => {
    manifest.files[0].bytes -= 1;
  });
  assert.throws(() => validateBundle(result.directory), /大小/);
});
