/**
 * StorageAdapter — the attachment-storage contract for the widget.
 *
 * Attachments (images, PDFs the user drops into chat) are the second
 * pluggable backend, distinct from `ChatStore`. The connection/bucket is the
 * host app's (their Supabase bucket, their S3/R2, or — on the hosted tier —
 * ours), but the *security model* around it is owned by the package and
 * encoded here, because getting it wrong is a data leak and the original
 * scaffold got it wrong (it used a public bucket with permanent URLs).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Three rules every implementation MUST follow. They are the security model.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 1. PRIVATE AT REST. Stored objects must NOT be publicly readable. No
 *    public bucket, no permanent public URL. The only way to read an object
 *    is through a signed, expiring URL this adapter mints.
 *
 * 2. SIGNED, SHORT-LIVED READS. `upload` and `resign` return URLs that
 *    expire. A leaked URL stops working; it is not a forever-handle to the
 *    file. Expiry is the adapter's choice but should be short (minutes to a
 *    few hours) — long enough for the model to fetch the file mid-turn and
 *    for the user to see the thumbnail, short enough to bound exposure.
 *    History rehydration re-signs on demand (see `resign`), so short expiry
 *    costs nothing in UX.
 *
 * 3. USER-NAMESPACED, UNGUESSABLE PATHS. The adapter is *bound to one
 *    verified user* (like `ChatStore`). It derives the storage path itself
 *    from its bound `userId` — callers never supply the full path — so an
 *    upload cannot be aimed into another user's namespace. Paths include a
 *    random segment so they're unguessable even if a bucket were
 *    accidentally made listable.
 *
 * Because the adapter is user-bound, the IDOR-resistance argument from
 * `ChatStore` applies identically here: there is no parameter through which a
 * foreign user id or a fully-attacker-controlled path can enter.
 */

/**
 * A file presented for upload. Framework-agnostic: the router adapts the
 * incoming multipart `File`/`Blob` into this shape so the adapter never has
 * to know about Web `FormData` or Node streams.
 */
export interface UploadInput {
  /** Raw bytes of the file. */
  data: ArrayBuffer | Uint8Array;
  /** Original filename (used for display + to derive a safe path segment). */
  filename: string;
  /** MIME type the client claimed. The router validates it against the
   *  allow-list BEFORE calling upload; the adapter may re-check defensively. */
  mediaType: string;
  /** Size in bytes. The router enforces the size cap before calling upload. */
  size: number;
  /**
   * The conversation this attachment belongs to. Used only as a path segment
   * for organisation — NOT as an ownership signal (ownership comes from the
   * adapter's bound user). Optional; falls back to an "unfiled" segment.
   */
  conversationId?: string;
}

/**
 * The result of a successful upload — exactly the fields the client needs to
 * render the attachment and the system needs to re-sign it later. Shaped to
 * map directly onto an AI SDK file part plus our durable `storagePath`.
 */
export interface UploadResult {
  /** Durable, opaque pointer for re-signing. Persisted on the message part. */
  storagePath: string;
  /** Freshly-signed, expiring URL for immediate use (model fetch + preview). */
  url: string;
  /** Echoed back for convenience. */
  filename: string;
  mediaType: string;
  size: number;
}

export interface StorageAdapter {
  /**
   * The user this adapter is bound to. Read-only; set at construction. The
   * adapter uses it to namespace every path it writes.
   */
  readonly userId: string;

  /**
   * Store a file and return a signed URL plus its durable `storagePath`.
   *
   * The adapter:
   *  - derives the path from its bound `userId` + a random segment + a
   *    sanitised filename (callers cannot inject an absolute/foreign path),
   *  - writes the bytes to private storage,
   *  - mints and returns a short-lived signed URL.
   *
   * Throws on storage failure so the router can return a clean 5xx rather
   * than handing the client a half-uploaded attachment.
   */
  upload(input: UploadInput): Promise<UploadResult>;

  /**
   * Mint a fresh signed URL for an already-stored object, given the
   * `storagePath` returned by a prior `upload`.
   *
   * This is what makes short expiry on `upload` safe: when an old
   * conversation is reloaded, the router calls `resign` for each attachment
   * so the user always gets a live URL. It is a first-class operation, not a
   * TODO — the absence of this method in the original design forced every
   * consumer to reinvent it.
   *
   * Security: the adapter MUST verify the path belongs to its bound user's
   * namespace before signing, and return `null` if it does not (or if the
   * object is missing). A `null` here means "render a broken/expired
   * thumbnail", never "throw away the whole history" — so one missing blob
   * can't take down a conversation load.
   */
  resign(storagePath: string): Promise<string | null>;

  /**
   * Permanently delete a stored object by `storagePath`. Used when a
   * conversation is deleted. MUST verify the path is in the bound user's
   * namespace before deleting. No-op (does not throw) if the object is
   * already gone — delete is idempotent.
   */
  remove(storagePath: string): Promise<void>;
}

/**
 * Constructs a `StorageAdapter` bound to a specific, already-verified user —
 * same trust rules as `ChatStoreFactory`. `userId` must come from the server
 * session, never from request input.
 */
export type StorageAdapterFactory = (userId: string) => StorageAdapter;
