import { cn } from "../utils/cn";
import { isSafeDataImage, safeUrl } from "../utils/url-safety";
import { describeFile } from "./file-icons/describe-file";

export type MessageAttachment = {
  filename: string;
  mediaType: string;
  url: string;
  size?: number;
};

export type MessageAttachmentsProps = {
  attachments: MessageAttachment[];
  className?: string;
};

// Open the file's URL in a new tab. The filename and URL come from the
// (untrusted) AI message stream, so both are validated here to prevent
// DOM-based XSS. http(s)/blob URLs open directly; inline image data: URLs
// are rendered in a tiny viewer built with safe DOM APIs — the filename is
// set via the title/alt properties (assigned as text, never parsed as HTML)
// instead of raw document.write of unescaped values. Disallowed schemes
// (javascript:, vbscript:, non-image data:, ...) are dropped.
function openAttachment(attachment: MessageAttachment) {
  const safe = safeUrl(attachment.url);
  if (!safe) return;

  // Inline image previews: browsers won't navigate to a data: image as a
  // top-level document, so render it in a minimal viewer page.
  if (isSafeDataImage(safe)) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    const doc = w.document;
    doc.title = attachment.filename; // assigned as text, not parsed as HTML
    doc.body.style.cssText =
      "margin:0;padding:20px;background:#f5f5f5;display:flex;" +
      "justify-content:center;align-items:center;min-height:100vh;";
    const img = doc.createElement("img");
    img.setAttribute("src", safe); // validated as a data:image above
    img.setAttribute("alt", attachment.filename);
    img.style.cssText =
      "max-width:100%;max-height:100%;object-fit:contain;" +
      "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
    doc.body.appendChild(img);
    return;
  }

  window.open(safe, "_blank", "noopener,noreferrer");
}

export function MessageAttachments({ attachments, className }: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment, index) => {
        const isImage = attachment.mediaType.startsWith("image/");
        // Only render the inline preview if the URL passes the protocol
        // allowlist; otherwise fall back to the (guarded) file button.
        const safeImageSrc = isImage ? safeUrl(attachment.url) : undefined;
        if (isImage && safeImageSrc) {
          return (
            <div
              key={`${attachment.url ?? attachment.filename ?? "att"}-${index}`}
              className="group relative h-14 w-14 rounded-lg"
            >
              <img
                src={safeImageSrc}
                alt={attachment.filename}
                className="size-full rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => openAttachment(attachment)}
              />
            </div>
          );
        }
        const { Icon, label } = describeFile(attachment);
        return (
          <button
            key={`${attachment.url ?? attachment.filename ?? "att"}-${index}`}
            type="button"
            onClick={() => openAttachment(attachment)}
            className={cn(
              "group flex items-center gap-2 px-2.5 h-14 rounded-lg border max-w-[220px]",
              "hover:bg-[hsl(var(--chat-text)/0.04)] transition-colors text-left cursor-pointer",
            )}
          >
            <Icon className="size-5 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex flex-col leading-tight">
              <span className="text-[12px] font-medium truncate">
                {attachment.filename}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
