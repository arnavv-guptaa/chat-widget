import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('repository Drizzle schema configuration', () => {
  it('targets the runtime parts-first tables, not legacy exports', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    expect(() => execFileSync(process.execPath, ['scripts/assert-drizzle-schema.mjs'], {
      cwd: root,
      stdio: 'pipe',
    })).not.toThrow();
  });
});
