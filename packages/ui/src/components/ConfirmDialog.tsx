import * as React from "react";
import { Modal, type ModalProps } from "./Modal";
import { Button } from "./Button";

export type ConfirmTone = "primary" | "danger";

export interface ConfirmDialogProps
  extends Pick<ModalProps, "open" | "onClose" | "title" | "size" | "closeOnBackdrop" | "closeOnEsc" | "closeLabel"> {
  /** Optional body copy explaining the consequence. */
  description?: React.ReactNode;
  /** Confirm button text (consumer-supplied). */
  confirmLabel: string;
  /** Cancel button text (consumer-supplied). */
  cancelLabel: string;
  /** `danger` renders a destructive confirm button. Default "primary". */
  tone?: ConfirmTone;
  /** Disables + spins the confirm button (async confirm). */
  loading?: boolean;
  /** Called when the confirm button is pressed. */
  onConfirm: () => void;
}

/** A confirm/cancel dialog built on Modal. Reuses Modal's open/close/title surface. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description,
  confirmLabel, cancelLabel, tone = "primary", loading = false,
  size = "sm", closeOnBackdrop, closeOnEsc, closeLabel,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEsc={closeOnEsc}
      closeLabel={closeLabel}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description != null && <p className="fos-confirm__desc">{description}</p>}
    </Modal>
  );
}
