"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SectionProps {
  id: string;
  title: ReactNode;
  /** Small mono count printed after the title. */
  count?: ReactNode;
  /** Controls kept at the right of the header, outside the toggle button. */
  actions?: ReactNode;
  /** One-line summary shown in place of the body while folded. */
  summary?: ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  /** "plain" for the sidebar, "card" for the right panel. */
  variant?: "plain" | "card";
  children: ReactNode;
}

/** A foldable section; the open state lives in the prefs so it survives reloads. */
export default function Section({ id, title, count, actions, summary, open, onToggle, variant = "plain", children }: SectionProps) {
  const bodyId = `sec-${id}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  const head = (
    <div className="flex items-center justify-between gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 min-w-0 flex-1 justify-start gap-1.5 px-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(id)}
      >
        <Chevron className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{title}</span>
        {count !== undefined && <span className="font-mono text-[10px] tracking-normal tabular-nums normal-case">{count}</span>}
      </Button>
      {actions && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
    </div>
  );
  const body = open ? (
    <div id={bodyId}>{children}</div>
  ) : summary ? (
    <div className="truncate pl-4 text-[11px] text-muted-foreground">{summary}</div>
  ) : null;

  if (variant === "card") {
    return (
      <Card data-panel={id} className={cn("gap-1.5 rounded-md py-2 shadow-none", !open && "gap-0.5")}>
        <CardHeader className="px-2">{head}</CardHeader>
        {body && <CardContent className="px-2">{body}</CardContent>}
      </Card>
    );
  }
  return (
    <section data-panel={id} className={cn("mb-3.5 flex flex-col gap-1.5", !open && "mb-2 gap-0.5")}>
      {head}
      {body}
    </section>
  );
}
