/**
 * SDK v6 file chunks carry extra display/reference fields in providerMetadata.
 * This is presentation/candidate-reference projection ONLY, never provenance.
 * The server resolves storagePath against the exact-scope managed registry.
 */
export function filePartDetails(part: unknown): {
  filename: string; mediaType: string; url: string; size?: number; storagePath?: string;
} {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const file = record(part) ? part : {};
  const metadata = record(file.providerMetadata) && record(file.providerMetadata.mordn)
    && record(file.providerMetadata.mordn.sandboxFile) ? file.providerMetadata.mordn.sandboxFile : {};
  const filename = file.filename ?? metadata.filename;
  const size = file.size ?? metadata.size;
  const storagePath = file.storagePath ?? metadata.storagePath;
  return {
    filename: typeof filename === 'string' ? filename : 'unknown',
    mediaType: typeof file.mediaType === 'string' ? file.mediaType : 'application/octet-stream',
    url: typeof file.url === 'string' ? file.url : '',
    ...(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
    ...(typeof storagePath === 'string' && storagePath.length > 0 ? { storagePath } : {}),
  };
}
