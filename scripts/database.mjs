import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = resolve(root, '.runtime');
const data = join(runtime, 'postgres');
const socket = join(runtime, 'pg-socket');
const port = process.env.PGPORT || '55432';
const user = 'gongming';
const password = 'gongming_dev';
const env = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5' };
const action = process.argv[2] || 'up';
// pg_ctl passes -o through a shell; ordinary spawn argument quoting is insufficient here.
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function run(command, args, quiet = false) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
  });
  if (result.error) throw new Error(`${command} 不可用，请安装 PostgreSQL 16+ 并加入 PATH。`);
  if (result.status !== 0)
    throw new Error(`${command} 执行失败${quiet ? `：${result.stderr}` : ''}`);
  return result.stdout?.trim();
}
function running() {
  if (!existsSync(join(data, 'PG_VERSION'))) return false;
  return spawnSync('pg_ctl', ['-D', data, 'status'], { env, stdio: 'ignore' }).status === 0;
}
try {
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error('PGPORT 需为 1024–65535 的有效端口');
  if (!['up', 'down', 'status'].includes(action))
    throw new Error('用法：node scripts/database.mjs up|down|status');
  if (action === 'status') {
    console.log(running() ? `数据库运行中：127.0.0.1:${port}/gongming` : '项目数据库未运行。');
  } else if (action === 'down') {
    if (running()) run('pg_ctl', ['-D', data, 'stop', '-m', 'fast']);
    else console.log('项目数据库已停止。');
  } else {
    mkdirSync(runtime, { recursive: true });
    chmodSync(runtime, 0o700);
    mkdirSync(socket, { recursive: true });
    if (!existsSync(join(data, 'PG_VERSION'))) {
      const passfile = join(runtime, 'pg-init-password');
      writeFileSync(passfile, `${password}\n`, { mode: 0o600 });
      try {
        run('initdb', [
          '-D',
          data,
          '-U',
          user,
          '--encoding=UTF8',
          '--locale=C',
          '--auth-local=trust',
          '--auth-host=scram-sha-256',
          `--pwfile=${passfile}`,
        ]);
      } finally {
        rmSync(passfile, { force: true });
      }
    }
    if (!running())
      run('pg_ctl', [
        '-D',
        data,
        '-l',
        join(runtime, 'postgres.log'),
        '-o',
        `-h 127.0.0.1 -p ${port} -k ${shellQuote(socket)}`,
        '-w',
        'start',
      ]);
    const args = ['-h', '127.0.0.1', '-p', port, '-U', user];
    const found = run(
      'psql',
      [...args, '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'gongming'"],
      true,
    );
    if (found !== '1') run('createdb', [...args, 'gongming']);
    console.log(`数据库就绪：127.0.0.1:${port}/gongming（项目私有目录 .runtime/postgres）`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
