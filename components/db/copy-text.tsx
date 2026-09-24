"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Monospace text with a copy-to-clipboard button. */
export function CopyText({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied; the text stays selectable by hand.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="rounded-none bg-muted px-2 py-1 font-mono text-xs select-all">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        title={label ?? "Copy"}
        aria-label={label ?? "Copy"}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  )
}
