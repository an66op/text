export function postgresEnvironment(raw, inherited = process.env) {
  let dsn;
  try {
    dsn = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL 格式无效，请使用完整 PostgreSQL URI');
  }
  if (!['postgres:', 'postgresql:'].includes(dsn.protocol))
    throw new Error('DATABASE_URL 需要 PostgreSQL URI');
  for (const name of dsn.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].includes(name))
      throw new Error('DATABASE_URL 包含备份工具不支持的参数，请使用明确的主机与 SSL 配置');
  }
  const environment = { ...inherited };
  // libpq connection variables can redirect a host or apply a service/option file.
  // Only the explicit URI and the settings below define the target of this tool.
  for (const key of Object.keys(environment)) if (key.startsWith('PG')) delete environment[key];
  try {
    Object.assign(environment, {
      PGHOST: dsn.hostname,
      PGPORT: dsn.port || '5432',
      PGUSER: decodeURIComponent(dsn.username),
      PGPASSWORD: decodeURIComponent(dsn.password),
      PGDATABASE: decodeURIComponent(dsn.pathname.slice(1)),
      PGSSLMODE: dsn.searchParams.get('sslmode') || 'prefer',
      PGCONNECT_TIMEOUT: '5',
    });
  } catch {
    throw new Error('DATABASE_URL 的字符编码无效');
  }
  for (const [query, variable] of [
    ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcert', 'PGSSLCERT'],
    ['sslkey', 'PGSSLKEY'],
  ]) {
    if (dsn.searchParams.has(query)) environment[variable] = dsn.searchParams.get(query);
  }
  if (!environment.PGHOST || !environment.PGDATABASE || !environment.PGUSER)
    throw new Error('DATABASE_URL 需要主机、数据库和用户名');
  return environment;
}
export function restrictRestoreTarget(environment) {
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(environment.PGHOST) ||
    environment.PGPORT !== '55432'
  )
    throw new Error('自动恢复演练仅允许项目本机 55432 实例；生产请在独立演练环境执行。');
  return { ...environment, PGHOSTADDR: environment.PGHOST === '[::1]' ? '::1' : '127.0.0.1' };
}
