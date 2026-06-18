/**
 * Default StorageAdapter implementation, on Supabase Storage.
 *
 * This ships the *correct* attachment security model as the default — the one
 * the original scaffold got wrong. It is one implementation of the
 * `StorageAdapter` interface; a BYO adapter (S3/R2/GCS) is equally valid.
 *
 * The three interface rules, as implemented here:
 *
 *   1. PRIVATE AT REST — the bucket must be created as a *private* bucket in
 *      Supabase. We never call `getPublicUrl`. (If the bucket is public, that
 *      is a host-app misconfiguration; this adapter never relies on it.)
 *
 *   2. SIGNED, SHORT-LIVED READS — `upload` and `resign` return
 *      `createSignedUrl` results with a bounded TTL.
 *
 *   3. USER-NAMESPACED, UNGUESSABLE PATHS — every path is
 *      `<userId>/<conversationId>/<randomUUID>/<safeFilename>`. The adapter is
 *      bound to one verified user and derives the path itself, so an upload
 *      cannot land in another user's namespace. `resign`/`remove` refuse paths
 *      outside the bound user's prefix.
 */

import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  StorageAdapter,
  UploadInput,
  UploadResult,
} from '../../storage-adapter';

const DEFAULT_BUCKET = 'chat-attachments';
// Short by design: the upload URL is used within seconds (model fetch +
// thumbnail), and history reloads re-sign on demand. One hour is a generous
// ceiling that still bounds the exposure of a leaked URL.
const DEFAULT_SIGNED_TTL_SECONDS = 60 * 60;

export interface SupabaseStorageOptions {
  /** Supabase project URL. Defaults to `process.env.NEXT_PUBLIC_SUPABASE_URL`. */
  supabaseUrl?: string;
  /**
   * Service-role key. Required — signing + private writes need it. Defaults to
   * `process.env.SUPABASE_SERVICE_ROLE_KEY`. NEVER expose this to the client;
   * this adapter only ever runs server-side (guarded by `server-only`).
   */
  serviceRoleKey?: string;
  /** Storage bucket name. Defaults to `chat-attachments`. Must be PRIVATE. */
  bucket?: string;
  /** Signed-URL TTL in seconds. Defaults to 3600 (1 hour). */
  signedUrlTtlSeconds?: number;
}

/** Strip anything that could break a storage path; clamp length. */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return cleaned.length ? cleaned : 'file';
}

class SupabaseStorageAdapter implements StorageAdapter {
  private readonly bucket: string;
  private readonly ttl: number;
  /** Path prefix this adapter is allowed to touch: `<userId>/`. */
  private readonly userPrefix: string;

  constructor(
    public readonly userId: string,
    private readonly client: SupabaseClient,
    bucket: string,
    ttl: number,
  ) {
    this.bucket = bucket;
    this.ttl = ttl;
    this.userPrefix = `${userId}/`;
  }

  /** Guard: a path is only operable if it lives under the bound user's prefix. */
  private ownsPath(storagePath: string): boolean {
    return storagePath.startsWith(this.userPrefix) && !storagePath.includes('..');
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const token = crypto.randomUUID();
    const filename = safeFilename(input.filename);
    const conversationSegment = input.conversationId
      ? safeFilename(input.conversationId)
      : 'unfiled';
    // Path is fully derived from the bound userId — callers can't inject it.
    const path = `${this.userId}/${conversationSegment}/${token}/${filename}`;

    const body =
      input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);

    const { error: uploadError } = await this.client.storage
      .from(this.bucket)
      .upload(path, body, {
        contentType: input.mediaType,
        cacheControl: '3600',
        upsert: false,
      });
    if (uploadError) {
      throw new Error(`[chat-widget] storage upload failed: ${uploadError.message}`);
    }

    const url = await this.signOrThrow(path);
    return {
      storagePath: path,
      url,
      filename: input.filename,
      mediaType: input.mediaType,
      size: input.size,
    };
  }

  async resign(storagePath: string): Promise<string | null> {
    // Refuse to sign anything outside the bound user's namespace.
    if (!this.ownsPath(storagePath)) return null;
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(storagePath, this.ttl);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  async remove(storagePath: string): Promise<void> {
    if (!this.ownsPath(storagePath)) return; // never delete outside the user's prefix
    // Supabase remove is idempotent — removing a missing object is not an error.
    await this.client.storage.from(this.bucket).remove([storagePath]);
  }

  private async signOrThrow(path: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, this.ttl);
    if (error || !data?.signedUrl) {
      throw new Error(
        `[chat-widget] failed to sign URL${error ? `: ${error.message}` : ''}`,
      );
    }
    return data.signedUrl;
  }
}

/**
 * Create a `StorageAdapterFactory` backed by Supabase Storage.
 *
 * Pass to `createChatHandler({ storage: createSupabaseStorage() })`. Requires
 * a PRIVATE `chat-attachments` bucket (or whatever `bucket` you name) and the
 * service-role key. Each adapter instance is bound to the verified `userId`
 * the handler provides per request; the Supabase client is shared.
 */
export function createSupabaseStorage(options: SupabaseStorageOptions = {}) {
  const supabaseUrl = options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      '[chat-widget] createSupabaseStorage needs NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY (or explicit options).',
    );
  }
  const bucket = options.bucket ?? DEFAULT_BUCKET;
  const ttl = options.signedUrlTtlSeconds ?? DEFAULT_SIGNED_TTL_SECONDS;
  // One shared client; auth disabled (we use the service-role key directly).
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return (userId: string): StorageAdapter =>
    new SupabaseStorageAdapter(userId, client, bucket, ttl);
}
