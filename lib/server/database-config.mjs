/** Use an explicit trusted CA in hosts that cannot mount a certificate file. */
export function databaseConfig(connectionString = process.env.DATABASE_URL, certificate = process.env.DATABASE_CA_CERT) {
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!certificate) return { connectionString };
  const url = new URL(connectionString);
  // pg parses URL TLS options after its explicit config. Remove only those
  // options so they cannot replace verified TLS with an unverified mode.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.href, ssl: { ca: certificate.replace(/\\n/g, '\n'), rejectUnauthorized: true } };
}
