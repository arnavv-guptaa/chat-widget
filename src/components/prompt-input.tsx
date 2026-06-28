"use client";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import { cn } from "../utils/cn";
import type { ChatStatus, FileUIPart } from "ai";
import {
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  PresentationIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import React, {
  type ChangeEventHandler,
  Children,
  ClipboardEventHandler,
  type ComponentProps,
  createContext,
  type FormEvent,
  type FormEventHandler,
  Fragment,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type AttachmentsContext = {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

const AttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const context = useContext(AttachmentsContext);

  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput"
    );
  }

  return context;
};

export type PromptInputAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart & { id: string };
  className?: string;
};

export function PromptInputAttachment({
  data,
  className,
  ...props
}: PromptInputAttachmentProps) {
  const attachments = usePromptInputAttachments();
  const isImage = data.mediaType?.startsWith("image/") && !!data.url;

  return (
    <div
      className={cn(
        "group relative rounded-lg border",
        // Images keep the square thumbnail. Other files use a wider
        // pill-shaped chip showing icon + filename — without it,
        // non-image attachments rendered as identical paperclip
        // squares with no way to tell them apart.
        isImage ? "h-14 w-14" : "h-14 max-w-[200px]",
        className,
      )}
      key={data.id}
      {...props}
    >
      {isImage ? (
        <img
          alt={data.filename || "attachment"}
          className="size-full rounded-lg object-cover"
          height={56}
          src={data.url}
          width={56}
        />
      ) : (
        <NonImageChip data={data} />
      )}
      <Button
        aria-label="Remove attachment"
        className="-right-1 -top-1 absolute h-4 w-4 rounded-full opacity-0 group-hover:opacity-100 p-0 [&_svg]:h-2 [&_svg]:w-2"
        onClick={() => attachments.remove(data.id)}
        size="icon"
        type="button"
        variant="outline"
      >
        <XIcon className="h-2 w-2 shrink-0" />
      </Button>
    </div>
  );
}

function NonImageChip({ data }: { data: FileUIPart & { id: string } }) {
  const { Icon, label } = describeFile(data);
  return (
    <div className="flex size-full items-center gap-2 px-2.5">
      <Icon className="size-5 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex flex-col leading-tight">
        <span className="text-[12px] font-medium truncate">
          {data.filename || "attachment"}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
    </div>
  );
}

// Match a file's mediaType / extension to a recognisable icon + short
// label. Falls back to a generic paperclip + the bare extension or
// "FILE" so the chip always carries some hint about the content.
function describeFile(data: FileUIPart & { id: string }): {
  Icon: typeof FileIcon;
  label: string;
} {
  const mt = (data.mediaType || "").toLowerCase();
  const ext = (data.filename || "").toLowerCase().split(".").pop() || "";
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

export type PromptInputAttachmentsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children: (attachment: FileUIPart & { id: string }) => React.ReactNode;
};

export function PromptInputAttachments({
  className,
  children,
  ...props
}: PromptInputAttachmentsProps) {
  const attachments = usePromptInputAttachments();
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      aria-live="polite"
      className={cn(
        "overflow-hidden transition-[height] duration-200 ease-out",
        className
      )}
      style={{ height: attachments.files.length ? height : 0 }}
      {...props}
    >
      <div className="flex flex-wrap gap-2 p-3 pt-3" ref={contentRef}>
        {attachments.files.map((file) => (
          <Fragment key={file.id}>{children(file)}</Fragment>
        ))}
      </div>
    </div>
  );
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "Add photos or files",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  return (
    <DropdownMenuItem
      {...props}
      onSelect={(e) => {
        e.preventDefault();
        attachments.openFileDialog();
      }}
    >
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  );
};

export type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
};

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string; // e.g., "image/*" or leave undefined for any
  multiple?: boolean;
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean;
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean;
  // Minimal constraints
  maxFiles?: number;
  maxFileSize?: number; // bytes
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  ...props
}: PromptInputProps) => {
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Find nearest form to scope drag & drop
  useEffect(() => {
    const root = anchorRef.current?.closest("form");
    if (root instanceof HTMLFormElement) {
      formRef.current = root;
    }
  }, []);

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") {
        return true;
      }
      // Proper HTML `accept` parsing: comma-separated tokens, each is
      // one of:
      //   - "*/*" — match anything
      //   - "<type>/*" — match by MIME prefix (image/*, audio/*, …)
      //   - "<type>/<subtype>" — exact MIME (application/pdf)
      //   - ".ext" — extension match against the filename
      // A file matches if ANY token matches. Previous version matched
      // only image/* when image/* was in the list, dropping every
      // non-image even if PDF/xlsx/etc. were explicitly listed.
      const tokens = accept
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const fileType = (f.type || "").toLowerCase();
      const fileName = f.name.toLowerCase();
      return tokens.some((token) => {
        if (token === "*/*") return true;
        if (token.startsWith(".")) return fileName.endsWith(token);
        if (token.endsWith("/*")) {
          const prefix = token.slice(0, -1); // "image/" from "image/*"
          return fileType.startsWith(prefix);
        }
        return fileType === token;
      });
    },
    [accept]
  );

  const add = useCallback(
    (files: File[] | FileList) => {
      const incoming = Array.from(files);
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (sized.length === 0 && accepted.length > 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return;
      }
      setItems((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }
        const next: (FileUIPart & { id: string })[] = [];
        for (const file of capped) {
          next.push({
            id: nanoid(),
            type: "file",
            url: URL.createObjectURL(file),
            mediaType: file.type,
            filename: file.name,
          });
        }
        return prev.concat(next);
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError]
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const file of prev) {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      }
      return [];
    });
  }, []);

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current) {
      // Clear the input when items are cleared
      if (items.length === 0) {
        inputRef.current.value = "";
      }
    }
  }, [items, syncHiddenInput]);

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add]);

  useEffect(() => {
    if (!globalDrop) {
      return;
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) {
      add(event.currentTarget.files);
    }
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();

    // Capture text + files synchronously, before any await. Once we await the
    // (possibly async) onSubmit, `event.currentTarget` is null and the
    // controlled value may already have changed.
    const form = event.currentTarget;
    const messageEl = form.elements.namedItem(
      "message"
    ) as HTMLTextAreaElement | null;
    const text = messageEl?.value ?? "";

    const files: FileUIPart[] = items.map(({ ...item }) => ({
      ...item,
    }));

    try {
      // `onSubmit` is frequently async — e.g. it uploads the attachments to a
      // server before sending. Await it so the attachments are only released
      // once the send has actually succeeded. Clearing eagerly (the previous
      // behaviour) revoked the blob: object URLs while the upload was still
      // reading them, and dropped the user's attachments on a failed send so
      // they had nothing to retry with.
      const result = onSubmit({ text, files }, event);
      if (result instanceof Promise) {
        await result;
      }
      // Success — safe to clear and revoke the now-unused object URLs.
      clear();
    } catch {
      // Keep the attachments mounted so the user can retry after a failed send.
    }
  };

  const ctx = useMemo<AttachmentsContext>(
    () => ({
      files: items.map((item) => ({ ...item, id: item.id })),
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef: inputRef,
    }),
    [items, add, remove, clear, openFileDialog]
  );

  return (
    <AttachmentsContext.Provider value={ctx}>
      <span aria-hidden="true" className="hidden" ref={anchorRef} />
      <input
        accept={accept}
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        type="file"
      />
      <form
        className={cn(
          // The form border + horizontal divider colour both come from
          // the styles.src.css `.chat-widget-container form ...` rules so
          // there's a single token (--chat-divider) controlling both.
          // No utility classes for border colour here.
          "w-full overflow-hidden rounded-xl bg-background transition-colors",
          "[&:focus-within]:shadow-none [&:focus]:shadow-none shadow-none",
          className
        )}
        onSubmit={handleSubmit}
        style={{ boxShadow: 'none' }}
        {...props}
      />
    </AttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn(className, "flex flex-col")} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<typeof Textarea>;

// Resting height (empty, one line ≈ leading-7) and max height before scrolling.
const TEXTAREA_MIN_HEIGHT = 28;
const TEXTAREA_MAX_HEIGHT = 192;

export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(({
  onChange,
  onKeyDown: externalOnKeyDown,
  className,
  placeholder = "What would you like to know?",
  value,
  ...props
}, ref) => {
  const attachments = usePromptInputAttachments();

  // Auto-grow via JS scrollHeight measurement — works in every browser. (The
  // CSS `field-sizing-content` property isn't supported in Safari/Firefox, so
  // the textarea wouldn't grow there.) The textarea grows with content up to
  // TEXTAREA_MAX_HEIGHT, then scrolls.
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
  };
  const resize = () => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
    el.style.height = `${Math.max(next, TEXTAREA_MIN_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  };
  // Re-measure whenever the value changes (covers controlled value resets like
  // clearing the input after send).
  useLayoutEffect(resize, [value]);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // Let external handlers (e.g. inputPlugins popover navigation) run
    // first. If they call preventDefault we skip the built-in
    // Enter-to-submit behaviour entirely.
    externalOnKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.key === "Enter") {
      // Don't submit if IME composition is in progress
      if (e.nativeEvent.isComposing) {
        return;
      }

      if (e.shiftKey) {
        // Allow newline
        return;
      }

      // Submit on Enter (without Shift)
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const items = event.clipboardData?.items;
    
    if (!items) {
      return;
    }

    const files: File[] = [];
    
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      attachments.add(files);
    }
  };

  return (
    <Textarea
      ref={setRefs}
      rows={1}
      value={value}
      className={cn(
        "w-full resize-none rounded-none border-none px-3 py-2.5 shadow-none outline-none ring-0",
        "focus-visible:ring-0 focus-visible:shadow-none focus:ring-0 focus:shadow-none",
        className
      )}
      style={{ minHeight: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT, overflowY: "hidden" }}
      name="message"
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
    />
  );
});
PromptInputTextarea.displayName = "PromptInputTextarea";

export type PromptInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputToolbar = ({
  className,
  ...props
}: PromptInputToolbarProps) => (
  <div
    className={cn("flex items-center justify-between p-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn(
      "flex items-center gap-1",
      "[&_button:first-child]:rounded-bl-xl",
      className
    )}
    {...props}
  />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    (size ?? Children.count(props.children) > 1) ? "default" : "icon";

  return (
    <Button
      className={cn(
        "shrink-0 gap-1.5 rounded-lg",
        variant === "ghost" && "text-muted-foreground",
        newSize === "default" && "px-3",
        className
      )}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = ComponentProps<
  typeof Button
> & {};
export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton className={className} {...props}>
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropdownMenuContent
>;
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropdownMenuItem
>;
export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem className={cn(className)} {...props} />
);

// Note: Actions that perform side-effects (like opening a file dialog)
// are provided in opt-in modules (e.g., prompt-input-attachments).

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  /**
   * Called when the user clicks the button while a response is streaming.
   * When provided, the button STOPS being a form-submit during the
   * streaming state and instead calls this handler. The submit action
   * (Enter / click) still works normally in `ready` and `error` states.
   *
   * Usage: `onStop={chat.stop}` from useChat. Without this prop, the
   * button stays a plain submit and the streaming icon is purely
   * cosmetic — backwards compatible for consumers who don't wire stop.
   */
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let Icon = <SendIcon className="size-4" />;

  if (status === "submitted") {
    Icon = <Loader2Icon className="size-4 animate-spin" />;
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    Icon = <XIcon className="size-4" />;
  }

  // While streaming, the click means "stop" — short-circuit form submit
  // by setting type="button" and calling onStop directly.
  const isStopping = status === "streaming" && !!onStop;

  return (
    <Button
      className={cn("gap-1.5 rounded-lg", className)}
      size={size}
      type={isStopping ? "button" : "submit"}
      variant={variant}
      onClick={(e) => {
        if (isStopping) {
          e.preventDefault();
          onStop();
        }
        onClick?.(e);
      }}
      aria-label={isStopping ? "Stop generating" : undefined}
      {...props}
    >
      {children ?? Icon}
    </Button>
  );
};

export type PromptInputModelSelectProps = ComponentProps<typeof Select>;

export const PromptInputModelSelect = (props: PromptInputModelSelectProps) => (
  <Select {...props} />
);

export type PromptInputModelSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const PromptInputModelSelectTrigger = ({
  className,
  ...props
}: PromptInputModelSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      "border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors",
      'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground',
      className
    )}
    {...props}
  />
);

export type PromptInputModelSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const PromptInputModelSelectContent = ({
  className,
  ...props
}: PromptInputModelSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
);

export type PromptInputModelSelectItemProps = ComponentProps<typeof SelectItem>;

export const PromptInputModelSelectItem = ({
  className,
  ...props
}: PromptInputModelSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
);

export type PromptInputModelSelectValueProps = ComponentProps<
  typeof SelectValue
>;

export const PromptInputModelSelectValue = ({
  className,
  ...props
}: PromptInputModelSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
);
