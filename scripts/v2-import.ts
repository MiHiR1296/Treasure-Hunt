import { readFile, writeFile } from 'node:fs/promises';
import { importLegacy } from '../lib/server/legacy-import';
async function main() {
  const [input, output, huntId] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: npm run import:v1 -- export.json review.json [hunt-id]');
  const report = importLegacy(JSON.parse(await readFile(input,'utf8')),huntId);
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(`Wrote a content draft with ${report.issues.length} configuration issues to ${output}. Review it before publication. No database was changed.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed.'); process.exitCode = 1; });
