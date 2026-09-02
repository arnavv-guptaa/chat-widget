/**
 * Tiny declarative field schema + reader used by the canonical AgentConfig
 * contract (`src/config.ts`).
 *
 * WHY THIS EXISTS (and why it isn't zod): the config contract is consumed by
 * three repos and, more importantly, by MANY DEPLOYED VERSIONS of this package
 * at once. A field that the dashboard publishes today is read tomorrow by a
 * customer's server that was installed six weeks ago. The one property the
 * validator must therefore have is *forward tolerance*: a document that carries
 * a field this build has never heard of must still load. A hand-rolled engine
 * lets us make that guarantee structural — every validator in the package is
 * derived from ONE descriptor, and the read mode (strict vs tolerant) is a
 * parameter, so "strict here, tolerant there" can never drift.
 *
 * Two modes, one descriptor:
 *
 *   • `strict`   — the WRITER contract. Unknown keys and invalid values are
 *                  errors. Used where a document is authored or accepted for
 *                  storage (publish, preview trust boundary). Strictness at the
 *                  writer is what keeps typos and junk out of the store.
 *   • `tolerant` — the READER contract. Unknown keys are DROPPED (recorded, not
 *                  fatal). An OPTIONAL known field whose value this build cannot
 *                  interpret (a new enum member, a changed shape) is DROPPED so
 *                  the schema default applies. Only a missing/invalid REQUIRED
 *                  field is fatal. Used by every runtime consumer: the customer's
 *                  handler, the hosted config fetcher, the browser bootstrap.
 *
 * The invariant this buys: within one `schemaVersion`, an OLDER reader can
 * always load a NEWER document (additive fields are ignored; new enum members
 * fall back to defaults). A change that would break that — removing a field,
 * changing a field's type or meaning, making an optional field required — is a
 * new `schemaVersion`. See docs/config-evolution.md.
 *
 * The reader always returns a NEW value containing only known, valid fields.
 * Callers never observe unknown keys, so downstream code cannot accidentally
 * depend on something the contract does not define.
 */

export type Primitive = string | number | boolean;

export type FieldSpec =
  | { kind: 'boolean' }
  | { kind: 'string'; nonEmpty?: boolean }
  | { kind: 'number'; integer?: boolean; min?: number; max?: number }
  | { kind: 'literal'; value: Primitive }
  | { kind: 'enum'; values: readonly Primitive[] }
  | { kind: 'object'; fields: FieldMap }
  | { kind: 'array'; item: FieldSpec }
  | { kind: 'union'; options: readonly FieldSpec[] };

export interface Field {
  spec: FieldSpec;
  /**
   * A required field that is missing or invalid is fatal in BOTH modes. Keep
   * this list tiny: every required field is a field an old reader cannot
   * default, i.e. a field that can never be added to an existing object
   * without a schema-version bump.
   */
  required?: boolean;
  /**
   * First package version whose canonical schema carried this field. Purely
   * informational (docs, dashboards showing "requires widget ≥ x"), but
   * mandatory so a field can never be added without recording when.
   */
  since: string;
  /** One-line, human-readable meaning. Surfaces in the schema description. */
  description: string;
  /**
   * Default applied by consumers when the field is absent or dropped. Only
   * meaningful on leaf fields. Recorded in the schema description so the
   * dashboard and docs can show it without a second source of truth.
   */
  default?: Primitive;
}

export type FieldMap = Record<string, Field>;

export type ReadMode = 'strict' | 'tolerant';

export type ReadIssueCode = 'unknown_key' | 'invalid_value' | 'missing_required';

export interface ReadIssue {
  /** Dotted path from the document root, e.g. `client.features.voiceInput`. */
  path: string;
  code: ReadIssueCode;
  message: string;
}

export type ReadResult<T> =
  | {
      ok: true;
      value: T;
      /**
       * Fields the reader ignored. Empty in strict mode (anything here would
       * have been an error). Non-empty in tolerant mode means "this document
       * was written by a newer schema than this build knows" — worth logging
       * once, never worth failing over.
       */
      dropped: ReadIssue[];
    }
  | { ok: false; issues: ReadIssue[] };

// ── helpers ──────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const join = (path: string, key: string | number): string =>
  path === '' ? String(key) : `${path}.${key}`;

/** Human label for a spec — used in issue messages and the schema description. */
export function describeSpec(spec: FieldSpec): string {
  switch (spec.kind) {
    case 'boolean':
      return 'boolean';
    case 'string':
      return spec.nonEmpty ? 'non-empty string' : 'string';
    case 'number': {
      const base = spec.integer ? 'integer' : 'number';
      const lo = spec.min !== undefined ? ` ≥ ${spec.min}` : '';
      const hi = spec.max !== undefined ? ` ≤ ${spec.max}` : '';
      return `${base}${lo}${hi}`;
    }
    case 'literal':
      return `literal ${JSON.stringify(spec.value)}`;
    case 'enum':
      return `one of ${spec.values.map((v) => JSON.stringify(v)).join(' | ')}`;
    case 'object':
      return 'object';
    case 'array':
      return `array of ${describeSpec(spec.item)}`;
    case 'union':
      return spec.options.map(describeSpec).join(' | ');
  }
}

// ── reader ───────────────────────────────────────────────────────────────────

/**
 * One issue describing a dropped optional field/item, at ITS path, with the
 * nested causes summarised relative to it (`textColor: required field is
 * missing`). Keeps `dropped` readable in logs: one line per thing that vanished.
 */
function droppedIssue(path: string, causes: readonly ReadIssue[]): ReadIssue {
  if (causes.length === 1 && causes[0].path === path) {
    return { path, code: 'invalid_value', message: causes[0].message };
  }
  const detail = causes
    .map((c) => `${c.path.startsWith(`${path}.`) ? c.path.slice(path.length + 1) : c.path}: ${c.message}`)
    .join('; ');
  return { path, code: 'invalid_value', message: `dropped (${detail})` };
}

interface Ctx {
  mode: ReadMode;
  dropped: ReadIssue[];
}

type Inner = { ok: true; value: unknown } | { ok: false; issues: ReadIssue[] };

function readSpec(value: unknown, spec: FieldSpec, path: string, ctx: Ctx): Inner {
  const invalid = (message: string): Inner => ({
    ok: false,
    issues: [{ path, code: 'invalid_value', message }],
  });

  switch (spec.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : invalid('expected a boolean');

    case 'string':
      if (typeof value !== 'string') return invalid('expected a string');
      if (spec.nonEmpty && value.trim().length === 0) return invalid('expected a non-empty string');
      return { ok: true, value };

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return invalid('expected a finite number');
      if (spec.integer && !Number.isSafeInteger(value)) return invalid('expected an integer');
      if (spec.min !== undefined && value < spec.min) return invalid(`expected a value ≥ ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) return invalid(`expected a value ≤ ${spec.max}`);
      return { ok: true, value };
    }

    case 'literal':
      return value === spec.value
        ? { ok: true, value }
        : invalid(`expected ${JSON.stringify(spec.value)}`);

    case 'enum':
      return (spec.values as readonly unknown[]).includes(value)
        ? { ok: true, value }
        : invalid(`expected ${describeSpec(spec)}`);

    case 'object':
      return readFields(value, spec.fields, path, ctx);

    case 'array': {
      if (!Array.isArray(value)) return invalid('expected an array');
      const out: unknown[] = [];
      const issues: ReadIssue[] = [];
      value.forEach((item, index) => {
        const read = readSpec(item, spec.item, join(path, index), ctx);
        if (read.ok) {
          out.push(read.value);
        } else if (ctx.mode === 'tolerant') {
          // A single unreadable item must not take the whole list down: an
          // older widget still renders the starter prompts it understands.
          ctx.dropped.push(droppedIssue(join(path, index), read.issues));
        } else {
          issues.push(...read.issues);
        }
      });
      return issues.length > 0 ? { ok: false, issues } : { ok: true, value: out };
    }

    case 'union': {
      // First option that reads cleanly wins. In tolerant mode an object option
      // may itself drop unknown keys — that is still a clean read.
      for (const option of spec.options) {
        const before = ctx.dropped.length;
        const read = readSpec(value, option, path, ctx);
        if (read.ok) return read;
        // Roll back drops recorded by an option that ultimately failed.
        ctx.dropped.length = before;
      }
      return invalid(`expected ${describeSpec(spec)}`);
    }
  }
}

function readFields(value: unknown, fields: FieldMap, path: string, ctx: Ctx): Inner {
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path, code: 'invalid_value', message: 'expected an object' }] };
  }

  const out: Record<string, unknown> = {};
  const issues: ReadIssue[] = [];

  // Unknown keys: fatal for a writer, ignorable for a reader.
  for (const key of Object.keys(value)) {
    if (key in fields) continue;
    const issue: ReadIssue = {
      path: join(path, key),
      code: 'unknown_key',
      message: 'not part of this schema version',
    };
    if (ctx.mode === 'strict') issues.push(issue);
    else ctx.dropped.push(issue);
  }

  for (const [key, field] of Object.entries(fields)) {
    const fieldPath = join(path, key);
    const present = key in value && value[key] !== undefined;

    if (!present) {
      if (field.required) {
        issues.push({ path: fieldPath, code: 'missing_required', message: 'required field is missing' });
      }
      continue;
    }

    const read = readSpec(value[key], field.spec, fieldPath, ctx);
    if (read.ok) {
      out[key] = read.value;
      continue;
    }

    // Invalid value. Required → always fatal. Optional → fatal for a writer,
    // dropped (default applies) for a reader. The drop is reported at the
    // FIELD's path (that is what disappeared), with the nested causes folded
    // into the message.
    if (field.required || ctx.mode === 'strict') {
      issues.push(...read.issues);
    } else {
      ctx.dropped.push(droppedIssue(fieldPath, read.issues));
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: out };
}

/**
 * Read `value` against `fields`. See the module doc for the two modes.
 *
 * `T` is the caller's promise about the shape `fields` describes; the engine
 * cannot prove it (that is what the `satisfies Record<keyof T, Field>` gate in
 * the descriptor is for).
 */
export function readObject<T>(value: unknown, fields: FieldMap, mode: ReadMode): ReadResult<T> {
  const ctx: Ctx = { mode, dropped: [] };
  const read = readFields(value, fields, '', ctx);
  if (!read.ok) return { ok: false, issues: read.issues };
  return { ok: true, value: read.value as T, dropped: ctx.dropped };
}

// ── schema description (for snapshots, docs, dashboards) ─────────────────────

export interface FieldDescription {
  path: string;
  kind: string;
  required: boolean;
  since: string;
  description: string;
  default?: Primitive;
  enum?: Primitive[];
  min?: number;
  max?: number;
  integer?: boolean;
  literal?: Primitive;
}

/**
 * Flatten a field map into a sorted list of leaf-and-branch descriptions. This
 * is the machine-readable form of the contract: the compatibility gate diffs
 * it against the last released baseline, and dashboards/docs can render it.
 */
export function describeFields(fields: FieldMap, prefix = ''): FieldDescription[] {
  const out: FieldDescription[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const path = join(prefix, key);
    describeInto(out, path, field.spec, field);
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function describeInto(out: FieldDescription[], path: string, spec: FieldSpec, field: Field): void {
  const base: FieldDescription = {
    path,
    kind: spec.kind === 'union' ? spec.options.map((o) => o.kind).join('|') : spec.kind,
    required: field.required === true,
    since: field.since,
    description: field.description,
  };
  if (field.default !== undefined) base.default = field.default;
  if (spec.kind === 'enum') base.enum = [...spec.values];
  if (spec.kind === 'literal') base.literal = spec.value;
  if (spec.kind === 'number') {
    if (spec.integer) base.integer = true;
    if (spec.min !== undefined) base.min = spec.min;
    if (spec.max !== undefined) base.max = spec.max;
  }
  out.push(base);

  const children = (s: FieldSpec): void => {
    if (s.kind === 'object') out.push(...describeFields(s.fields, path));
    else if (s.kind === 'array') children(s.item);
    else if (s.kind === 'union') s.options.forEach(children);
  };
  children(spec);
}
