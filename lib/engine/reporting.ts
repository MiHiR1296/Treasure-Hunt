/** Quote all fields and neutralize spreadsheet formula prefixes in untrusted names. */
export function resultsCsv(rows: { [key: string]: unknown; review?: { status: string } | null }[]) {
  const columns = ['name','id','huntId','version','revision','registrationCutoff','measuredAt','status','score','startedAt','deadlineAt','completedAt','elapsedSeconds','completed','skipped','hints','extensions','reviewStatus','reviewOutdated'];
  const cell = (value: unknown) => { const text = value == null ? '' : String(value); return `"${(typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`; };
  return [columns.join(','), ...rows.map(row => columns.map(key => cell(key === 'reviewStatus' ? row.review?.status ?? 'pending' : row[key])).join(','))].join('\r\n');
}
