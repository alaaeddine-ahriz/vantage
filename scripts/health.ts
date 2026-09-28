/**
 * Upstream health from the command line: `npx tsx scripts/health.ts` (add --json for the raw
 * report). Runs the same checks as /api/health, so a green table here and a red one on Vercel
 * points at the hosting network (bot walls, rate limits on datacenter IPs) rather than the code.
 */
import { checkHealth } from "../src/lib/health";

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const report = await checkHealth();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.checks.every((c) => c.ok) ? 0 : 1;
    return;
  }
  console.log(`Vantage upstream health, ${report.generatedAt}${report.mock ? " (mock)" : ""}\n`);
  const cols = { id: 22, ok: 5, status: 7, ms: 8 };
  console.log(`${pad("check", cols.id)}${pad("ok", cols.ok)}${pad("status", cols.status)}${pad("ms", cols.ms)}note`);
  console.log("-".repeat(90));
  for (const c of report.checks) {
    console.log(`${pad(c.id, cols.id)}${pad(c.ok ? "yes" : "NO", cols.ok)}${pad(c.status === null ? "-" : String(c.status), cols.status)}${pad(c.ms ? String(c.ms) : "-", cols.ms)}${c.note}`);
  }
  const bad = report.checks.filter((c) => !c.ok);
  console.log(`\n${report.checks.length - bad.length} ok, ${bad.length} failing`);
  for (const c of bad) if (c.url) console.log(`  ${c.id}: ${c.url}`);
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
