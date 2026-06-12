import { t } from "../t.js";

/** A blocking yes/no confirmation, used before destructive actions (FR-4.5). */
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onDismiss,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <p>{message}</p>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onDismiss}>
          {t("Nem")}
        </button>
      </div>
    </div>
  );
}
