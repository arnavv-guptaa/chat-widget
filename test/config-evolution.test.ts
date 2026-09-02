/**
 * The config-evolution gate. Two guarantees, both enforced here:
 *
 *  1. TOLERANT READERS. A document written by a newer schema (unknown fields at
 *     any level, a new enum member) loads on this build with the unknowns
 *     dropped. The STRICT validator rejects the same document. This is what
 *     stops "dashboard publishes a new field → every older install breaks".
 *
 *  2. NO BREAKING CHANGE WITHOUT A SCHEMA BUMP. `describeAgentConfigSchema()`
 *     is snapshotted (`agent-config.schema.snapshot.json`, refreshed with
 *     `vitest -u`) and diffed against the LAST RELEASE's baseline
 *     (`agent-config.schema.baseline.json`, refreshed only by
 *     `npm run config:baseline` at release time). Within one schemaVersion a
 *     field may be ADDED (optional) and an enum may GROW; nothing may be
 *     removed, retyped, tightened, or made required.
 *
 * See docs/config-evolution.md for the rules these tests encode.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AGENT_CONFIG_SCHEMA_VERSION,
  DEFAULT_FEATURES,
  describeAgentConfigSchema,
  isAgentBootstrap,
  isAgentConfig,
  readAgentBootstrap,
  readAgentConfig,
  resolveFeatures,
  type ConfigFieldDescription,
} from '../src/config';

const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const future = fixture('agent-config.future.json') as Record<string, unknown>;

const valid = {
  schemaVersion: 1 as const,
  runtime: { model: 'test/model', temperature: 0.2 },
  client: { features: { fileUpload: true }, display: { layout: 'popup' as const } },
};

describe('tolerant readers (runtime contract)', () => {
  it('loads a document from a newer schema, dropping every unknown field at every level', () => {
    const read = readAgentConfig(future);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.dropped.map((issue) => issue.path).sort()).toEqual([
      '$comment', // unknown key at the root
      'client.display.layout', // unknown enum member → default applies
      'client.display.motion',
      'client.features.readAloud',
      'client.features.readAloudVoice',
      'client.starterPrompts.1.icon',
      'client.voice',
      'runtime.topK',
    ]);
    // Unknown keys never reach consumers.
    expect(read.value.runtime).toEqual({ model: 'gateway/future-model', systemPrompt: 'Be helpful.' });
    expect(read.value.client.features).toEqual({ fileUpload: true });
    expect(read.value.client.display).toEqual({ size: 'large' });
    expect(read.value.client.starterPrompts).toEqual([{ title: 'Known' }, { title: 'With future icon' }]);
    expect('voice' in read.value.client).toBe(false);
  });

  it('the strict validator rejects the very same document (writer contract)', () => {
    expect(isAgentConfig(future)).toBe(false);
  });

  it('drops an optional field whose value it cannot interpret instead of failing', () => {
    const read = readAgentConfig({
      ...valid,
      client: { ...valid.client, streamingThrottleMs: -1, theme: { backgroundColor: '#fff' } },
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.dropped.map((issue) => issue.path).sort()).toEqual(['client.streamingThrottleMs', 'client.theme']);
    // A theme is never half-applied: the incomplete object is dropped whole.
    expect(read.value.client.theme).toBeUndefined();
  });

  it('still fails on the envelope: wrong schemaVersion or a missing required field', () => {
    expect(readAgentConfig({ ...valid, schemaVersion: 2 }).ok).toBe(false);
    expect(readAgentConfig({ ...valid, runtime: { temperature: 0.1 } }).ok).toBe(false);
    expect(readAgentConfig({ ...valid, runtime: { model: '' } }).ok).toBe(false);
    expect(readAgentConfig(null).ok).toBe(false);
    expect(readAgentConfig([]).ok).toBe(false);
  });

  it('round-trips a strictly valid document unchanged with nothing dropped', () => {
    const read = readAgentConfig(valid);
    expect(read).toEqual({ ok: true, value: valid, dropped: [] });
  });

  it('reads a bootstrap envelope with unknown envelope and client fields', () => {
    const bootstrap = {
      protocolVersion: 1,
      agent: 'agent-1',
      revision: 'rev-9',
      storageScope: 'scope',
      capabilities: { transcribe: true },
      client: { features: { fileUpload: true, readAloud: true } },
    };
    const read = readAgentBootstrap(bootstrap);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.dropped.map((issue) => issue.path).sort()).toEqual(['capabilities', 'client.features.readAloud']);
    expect(read.value.client.features).toEqual({ fileUpload: true });
    expect(isAgentBootstrap(bootstrap)).toBe(false);
    // The transport version is still a hard contract.
    expect(readAgentBootstrap({ ...bootstrap, protocolVersion: 2 }).ok).toBe(false);
  });
});

describe('defaults live in the descriptor', () => {
  it('resolveFeatures applies schema defaults and preserves explicit values', () => {
    expect(DEFAULT_FEATURES).toEqual({ fileUpload: false, fileUploadAccept: 'image/*', webSearch: false, voiceInput: true });
    expect(resolveFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(resolveFeatures({ fileUpload: true, fileUploadMaxBytes: 5 })).toEqual({
      fileUpload: true,
      fileUploadAccept: 'image/*',
      fileUploadMaxBytes: 5,
      webSearch: false,
      voiceInput: true,
    });
    expect(resolveFeatures({ voiceInput: false, voiceInputLanguage: 'en-GB' })).toMatchObject({
      voiceInput: false,
      voiceInputLanguage: 'en-GB',
    });
    expect(resolveFeatures({ fileUploadAccept: undefined })).toEqual(DEFAULT_FEATURES);
  });

  it('every declared default is present in the schema description', () => {
    const features = describeAgentConfigSchema().config.filter((f) => f.path.startsWith('client.features.'));
    const declared = Object.fromEntries(features.filter((f) => f.default !== undefined).map((f) => [f.path.split('.').pop(), f.default]));
    expect(declared).toEqual(DEFAULT_FEATURES);
  });
});

describe('schema compatibility gate', () => {
  const current = describeAgentConfigSchema();

  it('matches the committed snapshot (refresh deliberately with `vitest -u` and review the diff)', async () => {
    await expect(JSON.stringify(current, null, 2) + '\n').toMatchFileSnapshot('./fixtures/agent-config.schema.snapshot.json');
  });

  it('every field records the version that introduced it', () => {
    for (const field of [...current.config, ...current.bootstrap]) {
      expect(field.since, field.path).toMatch(/^\d+\.\d+\.\d+$/);
      expect(field.description.length, field.path).toBeGreaterThan(0);
    }
    const paths = current.config.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('is backward compatible with the last released baseline (no removals, retypes, tightening, or new required fields)', () => {
    const baseline = fixture('agent-config.schema.baseline.json') as ReturnType<typeof describeAgentConfigSchema>;
    expect(current.schemaVersion).toBe(AGENT_CONFIG_SCHEMA_VERSION);
    // A different schema major means the baseline no longer applies — reset it
    // in the same PR that bumps the version (and say so in the CHANGELOG).
    expect(baseline.schemaVersion).toBe(current.schemaVersion);
    expect(baseline.bootstrapProtocolVersion).toBe(current.bootstrapProtocolVersion);

    for (const section of ['config', 'bootstrap'] as const) {
      const before = new Map(baseline[section].map((f) => [f.path, f]));
      const after = new Map(current[section].map((f) => [f.path, f]));
      const problems: string[] = [];

      for (const [path, old] of before) {
        const now = after.get(path);
        if (!now) {
          problems.push(`${path}: removed (a removed field needs a new schemaVersion)`);
          continue;
        }
        if (now.kind !== old.kind) problems.push(`${path}: kind changed ${old.kind} → ${now.kind}`);
        if (now.required && !old.required) problems.push(`${path}: became required`);
        if (old.literal !== undefined && now.literal !== old.literal) problems.push(`${path}: literal changed`);
        if (old.enum) {
          const missing = old.enum.filter((v) => !now.enum?.includes(v));
          if (missing.length) problems.push(`${path}: enum members removed: ${missing.map(String).join(', ')}`);
        }
        if (old.min !== undefined && (now.min === undefined ? false : now.min > old.min)) problems.push(`${path}: min tightened ${old.min} → ${now.min}`);
        if (old.max !== undefined && (now.max === undefined ? false : now.max < old.max)) problems.push(`${path}: max tightened ${old.max} → ${now.max}`);
        if (old.integer && !now.integer) {
          // relaxing integer → number is fine; the reverse is a tightening
        } else if (!old.integer && now.integer) {
          problems.push(`${path}: tightened to integer`);
        }
        if (now.since !== old.since) problems.push(`${path}: 'since' rewritten (${old.since} → ${now.since}) — history is immutable`);
      }

      for (const [path, now] of after) {
        if (before.has(path)) continue;
        // A new field may only be required if it lives inside a NEW object
        // (i.e. some ancestor path is also new) — an old reader never sees it.
        const ancestorIsNew = ancestors(path).some((a) => after.has(a) && !before.has(a));
        if (now.required && !ancestorIsNew) {
          problems.push(`${path}: new REQUIRED field on an existing object (older readers cannot default it)`);
        }
      }

      expect(problems, `${section} schema is not backward compatible with the last release:\n  ${problems.join('\n  ')}`).toEqual([]);
    }
  });
});

function ancestors(path: string): string[] {
  const parts = path.split('.');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'));
}

// Keep the exported description type in use so a shape change is a compile error here too.
const _typeCheck: ConfigFieldDescription[] = describeAgentConfigSchema().config;
void _typeCheck;
