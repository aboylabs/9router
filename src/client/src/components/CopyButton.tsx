import { useState, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "../lib/utils";

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
  variant?: "icon" | "button";
}

export function CopyButton({ text, className, label, variant = "icon" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleCopy() {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    ta.value = text;
    ta.style.left = "0";
    ta.style.top = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0.01";
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    try {
      const ok = document.execCommand("copy");
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {}
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: "fixed", left: "0", top: "0",
          width: "1px", height: "1px", opacity: "0.01",
          pointerEvents: "none", zIndex: -1, border: "none", resize: "none"
        }}
        defaultValue=""
      />
      {variant === "button" ? (
        <button
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
            copied
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
              : "bg-surface-tertiary text-text-primary border border-border hover:bg-border/50",
            className
          )}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {label || (copied ? "Copied!" : "Copy All")}
        </button>
      ) : (
        <button
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center justify-center h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-tertiary transition-colors cursor-pointer",
            copied && "text-success",
            className
          )}
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </>
  );
}