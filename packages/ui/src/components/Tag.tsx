import * as React from "react";

export type TagTone = "ok" | "warning" | "danger" | "info" | "neutral" | "accent";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic status. Color reinforces meaning — the text must carry it too. */
  tone?: TagTone;
}

/**
 * Compact status label. Tones are semantic only (never decorative):
 * ok / warning / danger / info / neutral / accent.
 */
export function Tag({ tone = "neutral", children, className = "", ...rest }: TagProps) {
  return (
    <span className={`fos-tag fos-tag--${tone} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
