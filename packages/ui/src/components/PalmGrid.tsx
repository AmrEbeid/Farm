import * as React from "react";
import { PalmCell, type PalmStatus } from "./PalmCell";

export interface PalmCellData {
  id: string;
  status: PalmStatus;
  ariaLabel: string;
  glyph?: React.ReactNode;
  selected?: boolean;
}

export interface PalmLine {
  id: string;
  label: React.ReactNode;
  cells: PalmCellData[];
}

export interface PalmGridProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: PalmLine[];
  ariaLabel: string;
  onCellActivate?: (cellId: string, lineId: string) => void;
}

/**
 * Domain component: a grid map of palms laid out by line, inside a horizontal-scroll
 * container with line labels. Cells are PalmCell buttons; status→token mapping lives in PalmCell.
 */
export function PalmGrid({ lines, ariaLabel, onCellActivate, className = "", ...rest }: PalmGridProps) {
  return (
    <div className={`fos-palmgrid ${className}`.trim()} role="group" aria-label={ariaLabel} {...rest}>
      <div className="fos-palmgrid__scroll">
        {lines.map((line) => (
          <div className="fos-palmgrid__line" key={line.id}>
            <span className="fos-palmgrid__line-label">{line.label}</span>
            <div className="fos-palmgrid__cells">
              {line.cells.map((cell) => (
                <PalmCell
                  key={cell.id}
                  status={cell.status}
                  ariaLabel={cell.ariaLabel}
                  glyph={cell.glyph}
                  selected={cell.selected}
                  onClick={() => onCellActivate?.(cell.id, line.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
