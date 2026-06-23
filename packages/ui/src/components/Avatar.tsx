import * as React from "react";
import { safeImgSrc } from "./safeHref";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name — used as the accessible label and to derive initials. */
  name: string;
  /** Optional image URL; falls back to initials. */
  src?: string;
  /** Visual size. */
  size?: AvatarSize;
}

/** Up to two leading initials from the (whitespace-split) name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "");
}

/** User/entity avatar. Shows an image when `src` is set, otherwise initials. `name` labels it. */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, src, size = "md", className = "", ...rest },
  ref
) {
  // MEDIUM-2: only render an image for a safe scheme (http(s)/data:image), and fall back to
  // initials if it fails to load — so an unsafe or broken src never leaves an empty avatar.
  const safeSrc = safeImgSrc(src);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [safeSrc]);
  const showImg = safeSrc != null && !failed;

  return (
    <span
      ref={ref}
      className={`fos-avatar fos-avatar--${size} ${className}`.trim()}
      role="img"
      aria-label={name}
      {...rest}
    >
      {showImg ? (
        <img className="fos-avatar__img" src={safeSrc} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="fos-avatar__initials" aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
});
