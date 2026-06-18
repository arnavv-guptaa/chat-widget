import { cn } from "../utils/cn";
import {
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PresentationIcon,
} from "lucide-react";

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

// Open the file's URL in a new tab. Handles data: and blob: URLs that
// browsers won't navigate to directly by wrapping data URLs in a tiny
// HTML viewer so the image at least renders. http(s) URLs (signed
// Supabase URLs included) just open straight.
function openAttachment(attachment: MessageAttachment) {
  if (attachment.url.startsWith("data:")) {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(
        `<html><head><title>${attachment.filename}</title></head>` +
          `<body style="margin:0;padding:20px;background:#f5f5f5;` +
          `display:flex;justify-content:center;align-items:center;min-height:100vh;">` +
          `<img src="${attachment.url}" alt="${attachment.filename}" ` +
          `style="max-width:100%;max-height:100%;object-fit:contain;` +
          `border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);" />` +
          `</body></html>`,
      );
      w.document.close();
    }
    return;
  }
  window.open(attachment.url, "_blank");
}

function describeFile(att: MessageAttachment): {
  Icon: typeof FileIcon;
  label: string;
} {
  const mt = (att.mediaType || "").toLowerCase();
  const ext = (att.filename || "").toLowerCase().split(".").pop() || "";
  if (mt === "application/pdf" || ext === "pdf") return { Icon: FileTextIcon, label: "PDF" };
  if (
    mt.includes("spreadsheet") ||
    mt.includes("excel") ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv" ||
    ext === "tsv"
  ) {
    return { Icon: FileSpreadsheetIcon, label: ext.toUpperCase() || "Spreadsheet" };
  }
  if (
    mt.includes("presentation") ||
    mt.includes("powerpoint") ||
    ext === "pptx" ||
    ext === "ppt"
  ) {
    return { Icon: PresentationIcon, label: ext.toUpperCase() || "Slides" };
  }
  if (
    mt.includes("wordprocessing") ||
    mt.includes("msword") ||
    ext === "docx" ||
    ext === "doc"
  ) {
    return { Icon: FileTextIcon, label: ext.toUpperCase() || "Doc" };
  }
  if (mt.startsWith("text/") || ext === "txt" || ext === "md" || ext === "json") {
    return { Icon: FileTextIcon, label: ext.toUpperCase() || "Text" };
  }
  return { Icon: FileIcon, label: ext.toUpperCase() || "File" };
}

export function MessageAttachments({ attachments, className }: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment, index) => {
        const isImage = attachment.mediaType.startsWith("image/");
        if (isImage) {
          return (
            <div key={index} className="group relative h-14 w-14 rounded-lg">
              <img
                src={attachment.url}
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
            key={index}
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
