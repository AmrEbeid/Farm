import * as React from "react";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional title rendered in the card header. */
  title?: React.ReactNode;
  /** Optional muted sub-line under the title. */
  subtitle?: React.ReactNode;
}

/** Content container — surface, large radius, medium elevation. */
export function Card({ title, subtitle, children, className = "", ...rest }: CardProps) {
  return (
    <div className={`fos-card ${className}`.trim()} {...rest}>
      {title != null && <h3 className="fos-card__title">{title}</h3>}
      {subtitle != null && <p className="fos-card__sub">{subtitle}</p>}
      {children}
    </div>
  );
}
