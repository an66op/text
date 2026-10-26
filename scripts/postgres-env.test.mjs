import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresEnvironment, restrictRestoreTarget } from './postgres-env.mjs';
const uri = 'postgres://gongming:encoded%40password@127.0.0.1:55432/gongming?sslmode=disable';
test('backup libpq target ignores inherited redirection and service files', () => {
  const env = postgresEnvironment(uri, {
    PATH: '/bin',
    PGHOSTADDR: '203.0.113.10',
    PGSERVICE: 'production',
    PGSERVICEFILE: '/unexpected/service',
    PGOPTIONS: '-c search_path=other',
    PGDATABASE: 'other',
  });
  assert.equal(env.PGHOSTADDR, undefined);
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.PGSERVICEFILE, undefined);
  assert.equal(env.PGOPTIONS, undefined);
  assert.equal(env.PGDATABASE, 'gongming');
  assert.equal(env.PGPASSWORD, 'encoded@password');
  assert.equal(env.PATH, '/bin');
  assert.equal(restrictRestoreTarget(env).PGHOSTADDR, '127.0.0.1');
});
test('restore guard rejects remote or non-project targets and pins localhost to loopback', () => {
  assert.throws(() =>
    restrictRestoreTarget(postgresEnvironment(uri.replace('127.0.0.1', 'db.example.test'))),
  );
  assert.throws(() => restrictRestoreTarget(postgresEnvironment(uri.replace('55432', '5432'))));
  assert.equal(
    restrictRestoreTarget(postgresEnvironment(uri.replace('127.0.0.1', 'localhost'))).PGHOSTADDR,
    '127.0.0.1',
  );
  assert.throws(() => postgresEnvironment(`${uri}&hostaddr=203.0.113.10`));
});
test('malformed connection strings do not expose original secrets in error messages', () => {
  for (const value of [
    'invalid-PASSWORD_VALUE',
    'http://user:PASSWORD_VALUE@host/db',
    'postgres://gongming:%zz@localhost/db',
  ]) {
    assert.throws(
      () => postgresEnvironment(value),
      (error) => !error.message.includes('PASSWORD_VALUE') && !error.message.includes('%zz'),
    );
  }
});
