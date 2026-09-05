// Dependency-free static regression for #266. Run from any working directory:
//   node scripts/assert-drizzle-schema.mjs
// Reads source only: no package build, drizzle-kit, credentials, or database.
// This checks schema selection, NOT SQL execution or migration drift.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const config = read('drizzle.config.ts');
const targets = [...config.matchAll(/^\s*schema:\s*(['"])([^'"]+)\1\s*,?\s*$/gm)];
assert.equal(targets.length, 1, 'Expected one explicit repository schema target');
assert.equal(
  targets[0][2],
  './src/server/stores/drizzle/schema.ts',
  'Repository drizzle-kit must target the current ChatStore, not src/db/schema.ts',
);

const schema = read(targets[0][2]);
for (const [symbol, table] of [
  ['conversations', 'chat_conversations'],
  ['messages', 'chat_messages'],
]) {
  assert.match(
    schema,
    new RegExp(`export const ${symbol} = pgTable\\(\\s*['"]${table}['"]`),
    `The selected schema must define ${table}`,
  );
}
assert.match(schema, /parts:\s*jsonb\(['"]parts['"]\)/, 'Chat messages must use the parts-first schema');
assert.doesNotMatch(schema, /^import\s+['"]server-only['"]/m, 'The config must select schema-only source');

// Keep selection tied to the schema actually used by both runtime paths.
assert.match(
  read('src/server/stores/drizzle/client.ts'),
  /import\s+\*\s+as\s+schema\s+from\s+['"]\.\/schema['"];/,
);
assert.match(
  read('src/server/stores/drizzle/store.ts'),
  /import\s*\{[^}]*\bconversations\b[^}]*\bmessages\b[^}]*\}\s*from\s*['"]\.\/schema['"];/,
);

console.log('Repository Drizzle config selects the current parts-first ChatStore schema.');
