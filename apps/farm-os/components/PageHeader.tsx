import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  metadata,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`farm-page-header ${className}`.trim()}>
      <div className="farm-page-header__identity">
        <div className="farm-page-header__title-row">
          <h1 className="farm-page-header__title" title={typeof title === "string" ? title : undefined}>
            {title}
          </h1>
          {metadata}
        </div>
        {subtitle != null && <p className="farm-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="farm-page-header__actions">{actions}</div>}
    </header>
  );
}
