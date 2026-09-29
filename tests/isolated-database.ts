/** Safety interlock for every destructive DB/browser test entry point. */
export function assertIsolatedDatabase() {
  if (!process.env.DATABASE_URL) return;
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(url.hostname) || !/(?:^|[_-])test(?:$|[_-])/.test(url.pathname.slice(1))) {
    throw new Error('Tests require a disposable loopback/Postgres-service database whose name contains a test segment. Production and remote targets are rejected.');
  }
}
assertIsolatedDatabase();
