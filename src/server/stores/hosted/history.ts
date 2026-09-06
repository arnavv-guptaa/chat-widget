import type { ListMessagesOptions, StoredMessage } from '../../types';

/** This is a protocol acknowledgement, not the API/package release version. */
export const HISTORY_PAGINATION = 'created-at-id-v1';
export const HISTORY_PAGINATION_HEADER = 'X-Chat-History-Pagination';

export class HostedHistoryError extends Error {
  readonly code = 'HOSTED_HISTORY_UNAVAILABLE';
  constructor(message: string) {
    super(`[chat-widget] ${message}`);
    this.name = 'HostedHistoryError';
  }
}

export function historyQuery(opts?: ListMessagesOptions): { query: URLSearchParams; limit: number } {
  const requested = opts?.limit ?? 100;
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 101) : 100;
  if (opts?.before && !Number.isFinite(opts.before.getTime())) throw new HostedHistoryError('Invalid history timestamp');
  if (opts?.beforeId !== undefined && (!opts.before || !opts.beforeId || opts.beforeId.length > 1024 || /[\u0000-\u001f\u007f]/.test(opts.beforeId))) {
    throw new HostedHistoryError('Invalid history cursor');
  }
  const query = new URLSearchParams({ historyPagination: HISTORY_PAGINATION, limit: String(limit) });
  if (opts?.before) query.set('before', opts.before.toISOString());
  if (opts?.beforeId !== undefined) query.set('beforeId', opts.beforeId);
  return { query, limit };
}

/** UTF-8/C-collation order, independent of locale (ASCII ids retain their order). */
function compareId(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!);
  const right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export function assertHistoryPage(messages: StoredMessage[], limit: number, opts?: ListMessagesOptions): void {
  if (messages.length > limit) throw new HostedHistoryError('Hosted API returned an unbounded history page');
  const ids = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const row = messages[i];
    const time = row.createdAt.getTime();
    const prev = messages[i - 1];
    if (ids.has(row.id) || (prev && (prev.createdAt.getTime() > time || (prev.createdAt.getTime() === time && compareId(prev.id, row.id) >= 0)))) {
      throw new HostedHistoryError('Hosted API returned an unstable history page');
    }
    ids.add(row.id);
    if (opts?.before && !(time < opts.before.getTime() || (time === opts.before.getTime() && opts.beforeId !== undefined && compareId(row.id, opts.beforeId) < 0))) {
      throw new HostedHistoryError('Hosted API did not apply the history cursor');
    }
  }
}

export async function readHistoryResponse(res: Response): Promise<unknown[]> {
  if (res.status === 404) return [];
  if (!res.ok) throw new HostedHistoryError(`Hosted history request failed (${res.status})`);
  // Check EVERY response, including the first/probe page. A cached capability
  // from another instance is unsafe during rolling deploys and server rollback.
  if (res.headers.get(HISTORY_PAGINATION_HEADER) !== HISTORY_PAGINATION) {
    throw new HostedHistoryError('Hosted API lacks created-at-id-v1 pagination; deploy the compatible API before upgrading the widget');
  }
  const data = await res.json().catch(() => null) as { messages?: unknown } | null;
  if (!data || !Array.isArray(data.messages)) throw new HostedHistoryError('Invalid hosted history response');
  return data.messages;
}
