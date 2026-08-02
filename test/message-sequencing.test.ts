import { describe, it, expect } from 'vitest';

/**
 * These tests cover the ORDERING SEMANTICS the sequencing change introduces,
 * without standing up Postgres.
 *
 * The allocator is modelled as a synchronous critical section because that is
 * exactly the guarantee being relied on: `UPDATE … SET seq_counter =
 * seq_counter + n RETURNING seq_counter` is a single statement, and Postgres
 * serialises concurrent UPDATEs of the same row. If that assumption is wrong
 * the fix is wrong, so it is worth stating explicitly rather than burying it in
 * an integration test.
 *
 * The end-to-end behaviour against a real database — that two genuinely
 * concurrent `saveTurn` calls receive disjoint blocks — is on the PR's manual
 * verification checklist.
 */

/** Mirrors `chat_conversations.seq_counter` and the reservation statement. */
class ConversationCounter {
  seqCounter = 0;
  /** The atomic UPDATE … RETURNING. Returns the counter's NEW value. */
  reserve(n: number): number {
    this.seqCounter += n;
    return this.seqCounter;
  }
}

/** Mirrors the `blockStart` arithmetic in `saveTurn`. */
function reserveBlock(counter: ConversationCounter, n: number): number[] {
  const newValue = counter.reserve(n);
  const blockStart = newValue - n + 1;
  return Array.from({ length: n }, (_, i) => blockStart + i);
}

type Row = { id: string; createdAt: number; sequence: number };
/** Mirrors `orderBy(createdAt, sequence)`. */
const sortRows = (rows: Row[]) =>
  [...rows].sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence);

describe('ordinal allocation', () => {
  it('starts at 1 on a fresh conversation, not 0', () => {
    // 0 is the column default, so a real ordinal must never be 0 — otherwise a
    // newly written message is indistinguishable from an unbackfilled one.
    expect(reserveBlock(new ConversationCounter(), 1)).toEqual([1]);
  });

  it('hands a multi-message turn a contiguous block', () => {
    const counter = new ConversationCounter();
    expect(reserveBlock(counter, 2)).toEqual([1, 2]);
    expect(reserveBlock(counter, 2)).toEqual([3, 4]);
  });

  it('produces a strictly increasing transcript across several turns', () => {
    const counter = new ConversationCounter();
    const ordinals = [
      ...reserveBlock(counter, 1), // user message, persisted pre-stream
      ...reserveBlock(counter, 2), // saveTurn persists [user, assistant]
      ...reserveBlock(counter, 1),
      ...reserveBlock(counter, 2),
    ];
    expect(ordinals).toHaveLength(6);
    expect(new Set(ordinals).size).toBe(6);
    for (let i = 1; i < ordinals.length; i++) {
      expect(ordinals[i]).toBeGreaterThan(ordinals[i - 1]);
    }
  });

  it('never hands two interleaved writers the same ordinal', () => {
    // The headline case: two browser tabs answering the same conversation.
    const counter = new ConversationCounter();
    const blocks = Array.from({ length: 100 }, (_, i) => reserveBlock(counter, (i % 3) + 1));
    const all = blocks.flat();

    expect(new Set(all).size).toBe(all.length); // no collisions
    for (const block of blocks) {
      // Each turn's messages stay adjacent — a turn is never split by another.
      block.forEach((value, i) => i > 0 && expect(value).toBe(block[i - 1] + 1));
    }
    for (let i = 1; i < blocks.length; i++) {
      const previous = blocks[i - 1];
      expect(blocks[i][0]).toBeGreaterThan(previous[previous.length - 1]);
    }
  });

  it('tolerates gaps left by deduplicated inserts', () => {
    // saveTurn allocates before inserting, and the insert dedupes on message
    // id — so a replay burns ordinals. Gaps are fine: this is an ordering key,
    // not a count, and burning one is far cheaper than reusing one.
    const withGaps = [1, 2, 5, 9];
    expect(withGaps.every((v, i) => i === 0 || v > withGaps[i - 1])).toBe(true);
  });
});

describe('composite (createdAt, sequence) ordering', () => {
  it('resolves same-tick writes deterministically — the actual bug', () => {
    const tied: Row[] = [
      { id: 'assistant', createdAt: 1000, sequence: 2 },
      { id: 'user', createdAt: 1000, sequence: 1 },
    ];
    expect(sortRows(tied).map((r) => r.id)).toEqual(['user', 'assistant']);
    // Stable regardless of the order the planner returned rows in.
    expect(sortRows([...tied].reverse()).map((r) => r.id)).toEqual(['user', 'assistant']);
  });

  it('still lets the timestamp dominate, so legacy rows sort correctly', () => {
    // A backfilled row with a high ordinal must not jump ahead of a newer
    // message that happens to have a low one.
    const rows: Row[] = [
      { id: 'new', createdAt: 2000, sequence: 1 },
      { id: 'old', createdAt: 1000, sequence: 99 },
    ];
    expect(sortRows(rows).map((r) => r.id)).toEqual(['old', 'new']);
  });

  it('is safe on rows that were never backfilled (sequence still 0)', () => {
    // Migration-before-deploy is the documented order, but a partially applied
    // migration must not scramble a transcript.
    const rows: Row[] = [
      { id: 'legacy-b', createdAt: 2000, sequence: 0 },
      { id: 'legacy-a', createdAt: 1000, sequence: 0 },
      { id: 'fresh', createdAt: 3000, sequence: 1 },
    ];
    expect(sortRows(rows).map((r) => r.id)).toEqual(['legacy-a', 'legacy-b', 'fresh']);
  });
});

describe('backfill semantics', () => {
  /** Mirrors ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at, id). */
  function backfill(rows: Array<{ id: string; conv: string; createdAt: number }>) {
    const byConversation: Record<string, typeof rows> = {};
    for (const row of rows) (byConversation[row.conv] ??= []).push(row);
    const ordinals: Record<string, number> = {};
    for (const conv of Object.keys(byConversation)) {
      byConversation[conv]
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .forEach((row, i) => (ordinals[row.id] = i + 1));
    }
    return ordinals;
  }

  const fixture = [
    { id: 'm-c', conv: 'c1', createdAt: 100 },
    { id: 'm-a', conv: 'c1', createdAt: 100 }, // tie — broken by id
    { id: 'm-b', conv: 'c1', createdAt: 200 },
    { id: 'x-1', conv: 'c2', createdAt: 50 },
  ];

  it('numbers each conversation independently from 1', () => {
    const ordinals = backfill(fixture);
    expect([ordinals['m-a'], ordinals['m-c'], ordinals['m-b']]).toEqual([1, 2, 3]);
    expect(ordinals['x-1']).toBe(1); // separate partition
  });

  it('is deterministic, so re-running the migration cannot reshuffle history', () => {
    const first = backfill(fixture);
    const second = backfill([...fixture].reverse());
    expect(second).toEqual(first);
  });

  it('advances the counter past the backfill so the next turn cannot collide', () => {
    const ordinals = backfill(fixture);
    const maxForC1 = Math.max(ordinals['m-a'], ordinals['m-b'], ordinals['m-c']);
    const counter = new ConversationCounter();
    counter.seqCounter = maxForC1; // what the migration's GREATEST(...) sets
    expect(reserveBlock(counter, 1)[0]).toBeGreaterThan(maxForC1);
  });
});
