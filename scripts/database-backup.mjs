import { spawnSync } from 'node:child_process';
import { mkdirSync, chmodSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { postgresEnvironment, restrictRestoreTarget } from './postgres-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, '.runtime/backups');
const command = process.argv[2] || 'backup';
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
let env;
function run(program, args, database) {
  const result = spawnSync(program, args, {
    env: { ...env, ...(database ? { PGDATABASE: database } : {}) },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error)
    throw new Error(`${program} 不可用，请检查 PostgreSQL 工具安装`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${program} 执行失败：${result.stderr.trim()}`);
  return result.stdout.trim();
}
try {
  env = postgresEnvironment(
    process.env.DATABASE_URL ||
      'postgres://gongming:gongming_dev@127.0.0.1:55432/gongming?sslmode=disable',
  );
  if (!['backup', 'restore-check'].includes(command))
    throw new Error('用法：node scripts/database-backup.mjs backup | restore-check <dump文件>');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  if (command === 'backup') {
    const destination = join(directory, `gongming-${stamp}.dump`);
    run('pg_dump', ['--no-password', '--format=custom', `--file=${destination}`]);
    chmodSync(destination, 0o600);
    console.log(`一致性备份已保存：${destination}`);
    console.log('使用 npm run db:restore-check -- <文件> 在隔离临时数据库中验证恢复。');
  } else {
    env = restrictRestoreTarget(env);
    const source = process.argv[3] ? resolve(process.argv[3]) : '';
    if (!source || !existsSync(source)) throw new Error('请提供已存在的 dump 文件路径');
    const database = `gongming_restore_${Date.now()}`;
    let created = false;
    try {
      run('createdb', ['--no-password', database]);
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
          source,
        ],
        database,
      );
      const tables = run(
        'psql',
        [
          '--no-password',
          '-Atc',
          "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'gongming_%' ORDER BY tablename",
        ],
        database,
      )
        .split('\n')
        .filter(Boolean);
      if (!tables.length) throw new Error('备份中没有共鸣业务表');
      const counts = {};
      for (const table of tables) {
        if (!/^gongming_[a-z0-9_]+$/.test(table)) throw new Error('恢复表名称不符合预期');
        counts[table] = Number(
          run('psql', ['--no-password', '-Atc', `SELECT count(*) FROM "${table}"`], database),
        );
      }
      const report = join(directory, `restore-check-${stamp}.json`);
      writeFileSync(
        report,
        JSON.stringify(
          {
            verifiedAt: new Date().toISOString(),
            source,
            tables: counts,
            validation:
              'pg_restore --single-transaction --exit-on-error; schema, constraints and row counts readable',
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      console.log(`隔离恢复成功：${tables.length} 张业务表，数据与约束已导入并可读。`);
      console.log(`验收记录：${report}`);
    } finally {
      if (created) {
        run('dropdb', ['--no-password', '--force', database]);
        console.log('仅本次新建的演练数据库已清理，运行库未覆盖。');
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
