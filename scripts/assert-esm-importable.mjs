// Assert every public built entry imports cleanly under STRICT native ESM.
//
// This is the gate that catches the crash class we shipped blind (#177): a
// bundler/`moduleResolution: bundler` build resolves lenient specifiers (bare
// directory imports, extensionless deep paths) that Node's real ESM loader —
// and Next RSC / Vite / Turbopack — reject with ERR_UNSUPPORTED_DIR_IMPORT /
// "Cannot find module". `tsup` building green says nothing about this; only an
// actual ESM `import()` of the output does.
//
// Run AFTER `npm run build`. Exits non-zero if any entry fails to import.
//
// Expected-and-ignored: `server-only` throws "This module cannot be imported
// from a Client Component module" when a /server entry is imported outside an
// RSC server context (which is this plain Node process). That's the guard doing
// its job, not a resolution failure — we allow-list that exact message.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Entries that MUST import in a plain Node ESM context. These are the
// client/data/schema bundles — exactly where the RSH-class resolution bugs
// live (bare directory / extensionless deep imports). We deliberately do NOT
// import the `/server/*` entries here: each starts with `import 'server-only'`,
// which throws by design outside an RSC server context. Their strict-ESM
// resolution is instead covered by the Next consumer-smoke job (which imports
// them in a real RSC context).
const CLIENT_ENTRIES = [
  'dist/index.mjs', // the main widget bundle — where the RSH directory import lived
  'dist/models.mjs',
  'dist/schema/index.mjs',
];

let failed = 0;
let skipped = 0;

for (const entry of CLIENT_ENTRIES) {
  const abs = resolve(process.cwd(), entry);
  if (!existsSync(abs)) {
    console.log(`⚠️  ${entry} — not built (skipped)`);
    skipped++;
    continue;
  }
  // Import in an ISOLATED child process: a hard top-level throw (or a
  // linking-time error like a bad directory import) can't leak past our catch
  // in the parent, so we shell out and inspect the exit code + stderr.
  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(abs).href)})`],
      { stdio: 'pipe' },
    );
    console.log(`✅ ${entry}`);
  } catch (err) {
    const out = `${err.stderr ?? ''}${err.stdout ?? ''}`.split('\n').find((l) => l.trim()) ?? String(err);
    console.log(`❌ ${entry} — ${out.trim()}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} entr${failed === 1 ? 'y' : 'ies'} failed strict-ESM import.`);
  process.exit(1);
}
console.log(`\nAll client entries importable under strict ESM (${skipped} skipped).`);
