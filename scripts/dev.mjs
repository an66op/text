import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
const baseEnv = { ...process.env, APP_ENV: 'development' };
const managedDsn = `postgres://gongming:gongming_dev@127.0.0.1:${process.env.PGPORT || '55432'}/gongming?sslmode=disable`;
baseEnv.DATABASE_URL ||= managedDsn;
const apiAddress = process.env.API_ADDR || '127.0.0.1:8080';
const apiUrl = new URL(
  `http://${apiAddress.startsWith(':') ? `127.0.0.1${apiAddress}` : apiAddress}`,
);
if (apiUrl.hostname === '0.0.0.0' || apiUrl.hostname === '[::]') apiUrl.hostname = '127.0.0.1';
const apiPort = Number(apiUrl.port || 80);
baseEnv.VITE_API_TARGET ||= apiUrl.origin;
function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`端口 ${port} 已被占用，请先停止对应开发进程。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env: baseEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 启动准备失败`);
}
function start(name, command, args, cwd = root) {
  const child = spawn(command, args, { cwd, env: baseEnv, stdio: 'pipe', detached: true });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (value) => process.stdout.write(`[${name}] ${value}`));
  }
  child.on('error', (error) => {
    console.error(`[${name}] ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${name}] 已退出 (${code})`);
      stop(code || 1);
    }
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
  }
  // Database intentionally stays running; db:down stops it without deleting data.
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    }
    process.exit(code);
  }, 5000);
  timer.unref();
  Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve)),
    ),
  ).then(() => process.exit(code));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
try {
  await Promise.all([5173, 5174, apiPort].map(checkPort));
  if (baseEnv.DATABASE_URL === managedDsn) run(process.execPath, ['scripts/database.mjs', 'up']);
  mkdirSync(join(root, '.runtime/bin'), { recursive: true });
  run('go', ['build', '-o', join(root, '.runtime/bin/api'), './cmd/api'], join(root, 'server'));
  start('API', join(root, '.runtime/bin/api'), [], join(root, 'server'));
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline && !stopping) {
    try {
      const result = await fetch(`${apiUrl.origin}/api/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (result.ok) {
        ready = true;
        break;
      }
    } catch {
      /* API is still booting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Go 服务未就绪，请检查上方日志与数据库连接。');
  start('前台', process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host',
    '0.0.0.0',
    '--port',
    '5173',
    '--strictPort',
  ]);
  start(
    '后台',
    process.execPath,
    [
      join(root, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5174',
      '--strictPort',
    ],
    join(root, 'admin'),
  );
  console.log(
    `\n前台 http://localhost:5173 · 后台 http://localhost:5174 · Go API ${apiUrl.origin}\nCtrl+C 停止应用；npm run db:down 停止项目数据库。`,
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}
