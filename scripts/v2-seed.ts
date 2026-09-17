import { exampleHunt } from '../lib/engine/example';
import { publishHunt } from '../lib/server/store';
import { getPool } from '../lib/server/db';
import { canonicalJson } from '../lib/server/security';

async function main() {
  try {
    const { rows } = await getPool().query('select version,definition from hunt_v2.hunts where id=$1', [exampleHunt.id]);
    if (rows[0]) {
      const same = canonicalJson({ ...rows[0].definition, version: 1 }) === canonicalJson({ ...exampleHunt, version: 1 });
      if (same) { console.log(`Demo is already published: ${exampleHunt.title} (version ${rows[0].version}).`); return; }
      if (!process.argv.includes('--upgrade')) {
        console.log('A different demo version is already published. Existing teams are safe. Run npm run db:seed -- --upgrade to publish the new showcase for new teams.');
        return;
      }
    }
    const definition = await publishHunt(exampleHunt, rows[0] ? { expectedVersion: rows[0].version } : {});
    console.log(`Published ${definition.title} (version ${definition.version}) at /v2?hunt=${definition.id}.`);
    console.log('Organizer walkthrough and workshop answers: docs/v2/showcase.md');
  } finally { await getPool().end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo publication failed.'); process.exitCode = 1; });
