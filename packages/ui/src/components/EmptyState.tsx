import * as React from "react";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Headline (e.g. "لا توجد طلبات"). */
  title: React.ReactNode;
  /** Optional supporting line. */
  description?: React.ReactNode;
  /** Optional decorative icon. */
  icon?: React.ReactNode;
  /** Optional action slot (e.g. a Button). */
  action?: React.ReactNode;
}

/** Centered empty/zero-data placeholder: icon, title, description, optional action. */
export function EmptyState({ title, description, icon, action, className = "", ...rest }: EmptyStateProps) {
  return (
    <div className={`fos-empty ${className}`.trim()} {...rest}>
      {icon != null && <div className="fos-empty__icon" aria-hidden="true">{icon}</div>}
      <p className="fos-empty__title">{title}</p>
      {description != null && <p className="fos-empty__desc">{description}</p>}
      {action != null && <div className="fos-empty__action">{action}</div>}
    </div>
  );
}
