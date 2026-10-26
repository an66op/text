import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clearTimeout } from 'node:timers';
import { postgresEnvironment, restrictRestoreTarget } from './postgres-env.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const defaultDatabase = 'postgres://gongming:gongming_dev@127.0.0.1:55432/gongming?sslmode=disable';
const maxMetadataBytes = 32 * 1024 * 1024;
const idPattern = /^media_[a-f0-9]{32}$/;
const filenamePattern = /^media_[a-f0-9]{32}\.(jpg|png)$/;
const hashPattern = /^[a-f0-9]{64}$/;
const assetSQL = `SELECT COALESCE(json_agg(json_build_object(
  'id',id,'contentType',content_type,'bytes',bytes,
  'deletedAt',CASE WHEN deleted_at IS NULL THEN NULL ELSE to_char(deleted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
) ORDER BY id),'[]'::json) FROM public.gongming_media_assets`;

class BackupError extends Error {}
function requireThat(ok, message) {
  if (!ok) throw new BackupError(message);
}
function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function timestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function mediaFilename(asset) {
  requireThat(
    typeof asset?.id === 'string' && idPattern.test(asset.id),
    '媒体 ID 不符合固定文件命名规则。',
  );
  requireThat(
    ['image/jpeg', 'image/png'].includes(asset.contentType),
    '媒体类型不是受支持的 JPEG 或 PNG。',
  );
  return asset.id + (asset.contentType === 'image/jpeg' ? '.jpg' : '.png');
}
export function normalizeAssets(value) {
  requireThat(Array.isArray(value), '媒体元数据不是有效列表。');
  const seen = new Set();
  const result = value.map((row) => {
    requireThat(
      exactKeys(row, ['id', 'contentType', 'bytes', 'deletedAt']),
      '媒体元数据字段与契约不一致。',
    );
    mediaFilename(row);
    requireThat(!seen.has(row.id), '媒体元数据包含重复 ID。');
    seen.add(row.id);
    requireThat(
      Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 8388608,
      '媒体大小超出服务端存储约束。',
    );
    requireThat(row.deletedAt === null || timestamp(row.deletedAt), '媒体删除时间无效。');
    return { id: row.id, contentType: row.contentType, bytes: row.bytes, deletedAt: row.deletedAt };
  });
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

// Inspect every existing path component; O_NOFOLLOW below additionally protects
// the final file from replacement by a symlink between lstat and open.
export function checkedDirectory(path, { create = false, privateMode = false } = {}) {
  requireThat(
    typeof path === 'string' &&
      isAbsolute(path) &&
      resolve(path) === path &&
      path !== parse(path).root,
    '目录必须是非文件系统根的规范绝对路径。',
  );
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    if (create && !existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
    const info = lstatSync(cursor);
    requireThat(info.isDirectory() && !info.isSymbolicLink(), '目录路径不允许软链或非目录节点。');
  }
  requireThat(realpathSync(path) === path, '目录路径经过软链，已拒绝。');
  if (privateMode)
    requireThat((lstatSync(path).mode & 0o077) === 0, '媒体或备份目录必须仅当前用户可访问。');
  return path;
}
function privateDirectory(path, create = false) {
  // Existing directories belong to the operator. Never tighten permissions on
  // shared paths; only mkdir-created components receive the private mode.
  return checkedDirectory(path, { create, privateMode: true });
}
function sameFile(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
function openRegular(path) {
  checkedDirectory(dirname(path), { privateMode: true });
  const before = lstatSync(path, { bigint: true });
  requireThat(
    before.isFile() && !before.isSymbolicLink() && before.nlink === 1n,
    '只允许未硬链接的普通媒体文件，拒绝软链与特殊文件。',
  );
  requireThat((before.mode & 0o077n) === 0n, '媒体与备份文件必须是私有文件。');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd, { bigint: true });
    requireThat(info.isFile() && sameFile(before, info), '文件在安全打开期间发生变化。');
    return { fd, info };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
function finishRead(path, file) {
  const after = fstatSync(file.fd, { bigint: true });
  const named = lstatSync(path, { bigint: true });
  checkedDirectory(dirname(path), { privateMode: true });
  requireThat(
    named.isFile() &&
      !named.isSymbolicLink() &&
      sameFile(file.info, after) &&
      sameFile(after, named),
    '文件在读取期间被修改或替换。',
  );
}
export function fileDigest(path) {
  const file = openRegular(path);
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const count = readSync(file.fd, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count;
      requireThat(BigInt(bytes) <= file.info.size, '文件在读取期间增长，已中止校验。');
      hash.update(buffer.subarray(0, count));
    }
    finishRead(path, file);
    requireThat(
      BigInt(bytes) === file.info.size && Number.isSafeInteger(bytes),
      '文件长度与读取结果不一致。',
    );
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    closeSync(file.fd);
  }
}
function newPrivateFile(path) {
  checkedDirectory(dirname(path), { privateMode: true });
  return openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
}
function matchesDigest(actual, expected) {
  return actual.bytes === expected.bytes && actual.sha256 === expected.sha256;
}
export function copyVerifiedFile(source, destination, expected) {
  const before = fileDigest(source);
  requireThat(
    before.bytes === expected.bytes && (!expected.sha256 || before.sha256 === expected.sha256),
    '源文件大小或 SHA-256 与元数据不一致。',
  );
  const input = openRegular(source);
  let output;
  try {
    output = newPrivateFile(destination);
    const buffer = Buffer.alloc(64 * 1024);
    let copied = 0;
    for (;;) {
      const count = readSync(input.fd, buffer, 0, buffer.length, null);
      if (!count) break;
      copied += count;
      requireThat(copied <= expected.bytes, '文件在复制期间增长，已中止复制。');
      let written = 0;
      while (written < count) written += writeSync(output, buffer, written, count - written);
    }
    finishRead(source, input);
    fsyncSync(output);
  } finally {
    closeSync(input.fd);
    if (output !== undefined) closeSync(output);
  }
  requireThat(
    matchesDigest(fileDigest(source), before) && matchesDigest(fileDigest(destination), before),
    '复制前后媒体大小或 SHA-256 不一致。',
  );
  return before;
}
function inspectMediaDirectory(directory) {
  checkedDirectory(directory, { privateMode: true });
  const names = readdirSync(directory).sort();
  for (const name of names) {
    const info = lstatSync(join(directory, name));
    requireThat(
      filenamePattern.test(name) && info.isFile() && !info.isSymbolicLink() && info.nlink === 1,
      '媒体目录包含意外文件、软链、硬链接或子目录。',
    );
  }
  return names;
}
function writePrivateJson(path, value) {
  const fd = newPrivateFile(path);
  try {
    writeSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function readPrivateJson(path) {
  const file = openRegular(path);
  try {
    requireThat(file.info.size <= BigInt(maxMetadataBytes), '备份清单超过读取上限。');
    const buffer = Buffer.alloc(Number(file.info.size));
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(file.fd, buffer, offset, buffer.length - offset, null);
      requireThat(count > 0, '备份清单被截断。');
      offset += count;
    }
    finishRead(path, file);
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new BackupError('备份清单不是有效 JSON。');
    }
  } finally {
    closeSync(file.fd);
  }
}

export function validateManifest(value) {
  requireThat(
    exactKeys(value, ['version', 'createdAt', 'offline', 'database', 'assets', 'files']) &&
      value.version === 1 &&
      timestamp(value.createdAt) &&
      value.offline === 'operator-writers-stopped',
    '备份清单格式或离线声明不正确。',
  );
  requireThat(
    exactKeys(value.database, ['filename', 'bytes', 'sha256']) &&
      value.database.filename === 'database.dump' &&
      Number.isSafeInteger(value.database.bytes) &&
      value.database.bytes > 0 &&
      typeof value.database.sha256 === 'string' &&
      hashPattern.test(value.database.sha256),
    '数据库备份清单无效。',
  );
  const assets = normalizeAssets(value.assets);
  requireThat(Array.isArray(value.files), '媒体文件清单无效。');
  const live = new Map(
    assets.filter((asset) => asset.deletedAt === null).map((asset) => [asset.id, asset]),
  );
  const seen = new Set();
  for (const file of value.files) {
    requireThat(
      exactKeys(file, ['id', 'filename', 'bytes', 'sha256']) &&
        live.has(file.id) &&
        !seen.has(file.id),
      '媒体文件清单重复或与数据库记录不一致。',
    );
    const asset = live.get(file.id);
    requireThat(
      file.filename === mediaFilename(asset) &&
        file.bytes === asset.bytes &&
        typeof file.sha256 === 'string' &&
        hashPattern.test(file.sha256),
      '媒体文件名、大小或摘要不符合清单契约。',
    );
    seen.add(file.id);
  }
  requireThat(seen.size === live.size, '备份清单缺少未删除媒体文件。');
  return { ...value, assets, files: [...value.files].sort((a, b) => a.id.localeCompare(b.id)) };
}
export function validateBundle(source) {
  checkedDirectory(source, { privateMode: true });
  requireThat(
    readdirSync(source).sort().join(',') === 'database.dump,manifest.json,media',
    '备份目录包含缺失或意外节点。',
  );
  const manifest = validateManifest(readPrivateJson(join(source, 'manifest.json')));
  const media = checkedDirectory(join(source, 'media'), { privateMode: true });
  const names = inspectMediaDirectory(media);
  requireThat(
    JSON.stringify(names) === JSON.stringify(manifest.files.map((file) => file.filename).sort()),
    '备份媒体目录与清单文件集合不一致。',
  );
  requireThat(
    matchesDigest(fileDigest(join(source, 'database.dump')), manifest.database),
    '数据库备份 SHA-256 或大小不一致。',
  );
  for (const file of manifest.files)
    requireThat(
      matchesDigest(fileDigest(join(media, file.filename)), file),
      '媒体文件 SHA-256 或大小不一致。',
    );
  return manifest;
}

export function localEnvironment(inherited = process.env) {
  requireThat(
    inherited.APP_ENV === 'development',
    '媒体备份工具仅允许明确 APP_ENV=development 的本机开发环境。',
  );
  const environment = restrictRestoreTarget(
    postgresEnvironment(inherited.DATABASE_URL || defaultDatabase, inherited),
  );
  requireThat(
    /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(environment.PGDATABASE),
    '本机开发数据库名必须是普通标识符，拒绝连接字符串或路径。',
  );
  return environment;
}
export function apiProbeTargets(address = '127.0.0.1:8080') {
  const match = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|\[::\]):([0-9]{1,5})$/.exec(address);
  requireThat(
    match && Number(match[2]) > 0 && Number(match[2]) <= 65535,
    'API_ADDR 必须明确指定本机监听地址和有效端口。',
  );
  return [
    { host: '127.0.0.1', port: Number(match[2]) },
    { host: '::1', port: Number(match[2]) },
  ];
}
export async function apiIsListening(address) {
  const outcomes = await Promise.all(
    apiProbeTargets(address).map(
      (target) =>
        new Promise((accept, reject) => {
          const socket = createConnection(target);
          socket.setTimeout(1500);
          socket.once('connect', () => {
            socket.destroy();
            accept(true);
          });
          socket.once('timeout', () => {
            socket.destroy();
            reject(new BackupError('无法确认本机 API 已停止监听，已拒绝执行。'));
          });
          socket.once('error', (error) => {
            socket.destroy();
            if (['ECONNREFUSED', 'EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code))
              accept(false);
            else reject(new BackupError('本机 API 停机探测失败，已拒绝执行。'));
          });
        }),
    ),
  );
  return outcomes.some(Boolean);
}
export async function requireOffline(environment, writersStopped, probe = apiIsListening) {
  localEnvironment(environment);
  requireThat(writersStopped === true, '必须传入 --writers-stopped，明确声明所有实例已停止写入。');
  requireThat(
    !(await probe(environment.API_ADDR || '127.0.0.1:8080')),
    '配置的本机 API 仍在监听；请停止全部写入实例后再执行。',
  );
}
export function toolRunner(environment) {
  return (program, args, { database, stdoutFd } = {}) => {
    const result = spawnSync(program, args, {
      env: { ...environment, ...(database ? { PGDATABASE: database } : {}) },
      encoding: 'utf8',
      maxBuffer: maxMetadataBytes,
      timeout: 300000,
      ...(stdoutFd === undefined ? {} : { stdio: ['ignore', stdoutFd, 'pipe'] }),
    });
    // Do not forward PostgreSQL stderr: it may contain credentials, row values
    // or dump contents. The operation and exit status are sufficient here.
    requireThat(
      !result.error && result.status === 0,
      `${program} 执行失败，请检查本机 PostgreSQL 工具、权限与日志。`,
    );
    return result.stdout?.trim() || '';
  };
}
function decodeAssets(raw) {
  try {
    return normalizeAssets(JSON.parse(raw));
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('无法读取规范媒体表元数据。');
  }
}
function readAssets(run, database) {
  return decodeAssets(
    run('psql', ['--no-password', '-X', '-At', '--set=ON_ERROR_STOP=1', '--command', assetSQL], {
      database,
    }),
  );
}

// Keep this read-only transaction alive until pg_dump has imported its snapshot.
// It makes the dump and asset metadata one database snapshot; the operator's
// offline declaration is still required for filesystem consistency.
// PostgreSQL 16: /docs/16/app-pgdump.html (--snapshot) and
// /docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION.
export function openSnapshot(environment) {
  return new Promise((accept, reject) => {
    const child = spawn('psql', ['--no-password', '-X', '-qAt', '--set=ON_ERROR_STOP=1'], {
      env: environment,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '',
      ready = false,
      failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      child.kill('SIGTERM');
      reject(new BackupError('无法建立 PostgreSQL 只读导出快照。'));
    };
    const timer = setTimeout(fail, 15000);
    const closed = new Promise((done) =>
      child.once('close', (code) => {
        clearTimeout(timer);
        if (!ready) fail();
        done(code);
      }),
    );
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > maxMetadataBytes) {
        fail();
        return;
      }
      if (ready || !output.includes('\n')) return;
      try {
        const value = JSON.parse(output.trim());
        requireThat(
          typeof value.snapshot === 'string' &&
            /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{8}-[0-9]+$/.test(value.snapshot),
          '数据库快照标识无效。',
        );
        const assets = normalizeAssets(value.assets);
        ready = true;
        clearTimeout(timer);
        accept({
          snapshot: value.snapshot,
          assets,
          close: async () => {
            if (child.exitCode === null && !child.killed) child.stdin.end('ROLLBACK;\n\\q\n');
            const stop = setTimeout(() => child.kill('SIGTERM'), 5000);
            try {
              const code = await closed;
              requireThat(code === 0 && !failed, '导出快照事务未能正常关闭。');
            } finally {
              clearTimeout(stop);
            }
          },
        });
      } catch {
        fail();
      }
    });
    child.stdin.write(
      `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL idle_in_transaction_session_timeout='10min';\nSELECT json_build_object('snapshot',pg_export_snapshot(),'assets',(${assetSQL}));\n`,
    );
  });
}
function privateWorkspace(workspace) {
  checkedDirectory(workspace);
  return privateDirectory(join(workspace, '.runtime', 'backups'), true);
}

export async function backupMedia({
  workspace = root,
  environment = process.env,
  writersStopped = false,
  probe = apiIsListening,
  run,
  snapshot = openSnapshot,
} = {}) {
  await requireOffline(environment, writersStopped, probe);
  const env = localEnvironment(environment);
  run ||= toolRunner(env);
  const source = environment.MEDIA_DIRECTORY || join(workspace, '.runtime', 'media');
  checkedDirectory(source, { privateMode: true });
  const originalNames = inspectMediaDirectory(source);
  const destination = mkdtempSync(
    join(
      privateWorkspace(workspace),
      `media-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-`,
    ),
  );
  chmodSync(destination, 0o700);
  let complete = false,
    exported;
  try {
    privateDirectory(join(destination, 'media'), true);
    exported = await snapshot(env);
    const assets = normalizeAssets(exported.assets);
    const fd = newPrivateFile(join(destination, 'database.dump'));
    try {
      run('pg_dump', ['--no-password', '--format=custom', `--snapshot=${exported.snapshot}`], {
        stdoutFd: fd,
      });
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    await exported.close();
    exported = null;
    const files = [];
    for (const asset of assets.filter((value) => value.deletedAt === null)) {
      const filename = mediaFilename(asset);
      const digest = copyVerifiedFile(
        join(source, filename),
        join(destination, 'media', filename),
        { bytes: asset.bytes },
      );
      files.push({ id: asset.id, filename, ...digest });
    }
    requireThat(
      JSON.stringify(readAssets(run)) === JSON.stringify(assets),
      '备份期间媒体资产集合发生变化，不能确认离线一致性。',
    );
    requireThat(
      JSON.stringify(inspectMediaDirectory(source)) === JSON.stringify(originalNames),
      '备份期间媒体目录集合发生变化。',
    );
    for (const file of files)
      requireThat(
        matchesDigest(fileDigest(join(source, file.filename)), file),
        '备份结束时源媒体文件已变化。',
      );
    await requireOffline(environment, writersStopped, probe);
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      offline: 'operator-writers-stopped',
      database: { filename: 'database.dump', ...fileDigest(join(destination, 'database.dump')) },
      assets,
      files,
    };
    writePrivateJson(join(destination, 'manifest.json'), manifest);
    validateBundle(destination);
    complete = true;
    return { directory: destination, files: files.length, assets: assets.length };
  } finally {
    try {
      if (exported) await exported.close();
    } finally {
      if (!complete) rmSync(destination, { recursive: true, force: true });
    }
  }
}

export async function restoreCheckMedia({
  source,
  workspace = root,
  environment = process.env,
  writersStopped = false,
  probe = apiIsListening,
  run,
} = {}) {
  await requireOffline(environment, writersStopped, probe);
  const env = localEnvironment(environment);
  run ||= toolRunner(env);
  const manifest = validateBundle(source);
  const temporary = mkdtempSync(join(privateWorkspace(workspace), 'media-restore-check-'));
  chmodSync(temporary, 0o700);
  const database = `gongming_media_check_${randomBytes(12).toString('hex')}`;
  let created = false;
  try {
    privateDirectory(join(temporary, 'media'), true);
    // Stage immutable private copies before starting any database operation.
    copyVerifiedFile(
      join(source, 'database.dump'),
      join(temporary, 'database.dump'),
      manifest.database,
    );
    for (const file of manifest.files)
      copyVerifiedFile(
        join(source, 'media', file.filename),
        join(temporary, 'media', file.filename),
        file,
      );
    run('createdb', ['--no-password', '--maintenance-db=postgres', database]);
    created = true;
    run(
      'pg_restore',
      [
        '--no-password',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--single-transaction',
        `--dbname=${database}`,
        join(temporary, 'database.dump'),
      ],
      { database },
    );
    requireThat(
      JSON.stringify(readAssets(run, database)) === JSON.stringify(manifest.assets),
      '恢复数据库媒体元数据与备份清单不一致。',
    );
    requireThat(
      matchesDigest(fileDigest(join(temporary, 'database.dump')), manifest.database),
      '隔离恢复数据库文件与备份清单不一致。',
    );
    for (const file of manifest.files)
      requireThat(
        matchesDigest(fileDigest(join(temporary, 'media', file.filename)), file),
        '隔离恢复媒体文件与清单不一致。',
      );
    validateBundle(source);
    return { files: manifest.files.length, assets: manifest.assets.length };
  } finally {
    try {
      if (created)
        run('dropdb', ['--no-password', '--maintenance-db=postgres', '--force', database]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const writersStopped = args.includes('--writers-stopped');
  const values = args.filter((value) => value !== '--writers-stopped');
  const command = values[0];
  requireThat(
    (command === 'backup' && values.length === 1) ||
      (command === 'restore-check' && values.length === 2),
    '用法：media-backup.mjs backup --writers-stopped | restore-check <bundle目录> --writers-stopped',
  );
  if (command === 'backup') {
    const result = await backupMedia({ environment, writersStopped });
    console.log(`本机离线媒体备份已保存：${result.directory}`);
    console.log(
      `已核对 ${result.files} 个有效媒体文件；停写范围依赖操作者确认所有写入实例均已停止。`,
    );
  } else {
    const result = await restoreCheckMedia({
      source: resolve(values[1]),
      environment,
      writersStopped,
    });
    console.log(
      `隔离恢复验证通过：${result.assets} 条媒体元数据、${result.files} 个文件；本次临时数据库和目录已清理。`,
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      error instanceof BackupError
        ? error.message
        : '媒体备份工具失败，请检查本机路径、权限与 PostgreSQL 工具。',
    );
    process.exitCode = 1;
  });
}
