import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import type { AuthState } from "../../core/auth";
import { Button, Input, Modal, useToast } from "../../components";

interface DeletePreview {
  account: string;
  character: string;
  active: boolean;
  managed: boolean;
  in_yaml: boolean;
  in_db: boolean;
  inventory_items: number;
  has_configs: boolean;
  has_logs: boolean;
}

export interface DeleteCharacterModalProps {
  open: boolean;
  onClose: () => void;
  character: { account: string; char_name: string; active?: boolean } | null;
  auth: AuthState;
  onDeleted: () => void;
}

export function DeleteCharacterModal({
  open,
  onClose,
  character,
  auth,
  onDeleted,
}: DeleteCharacterModalProps) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (!open || !character) {
      setPreview(null);
      setTotpCode("");
      setError(null);
      return;
    }
    setLoadingPreview(true);
    setError(null);
    api<DeletePreview>(
      `/modules/accounts/entry/account/${encodeURIComponent(character.account)}/character/${encodeURIComponent(character.char_name)}/preview`,
      auth,
    )
      .then((data) => setPreview(data))
      .catch(() => {
        setPreview({
          account: character.account,
          character: character.char_name,
          active: Boolean(character.active),
          managed: false,
          in_yaml: true,
          in_db: true,
          inventory_items: 0,
          has_configs: false,
          has_logs: false,
        });
      })
      .finally(() => setLoadingPreview(false));
  }, [open, character, auth]);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (!character || !totpCode) return;
    setDeleting(true);
    setError(null);
    try {
      await api<{ ok: boolean; steps: { action: string; result: string }[] }>(
        `/modules/accounts/entry/account/${encodeURIComponent(character.account)}/character/${encodeURIComponent(character.char_name)}`,
        auth,
        {
          method: "DELETE",
          body: JSON.stringify({ totp_code: totpCode }),
        },
      );
      addToast({
        tone: "good",
        title: "Character Deleted",
        message: `Successfully deleted ${character.char_name} from ${character.account}.`,
      });
      onDeleted();
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg || "Failed to delete character");
    } finally {
      setDeleting(false);
    }
  }

  if (!character) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete Character — ${character.char_name}`}
      size="md"
    >
      <form onSubmit={handleDelete}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div
            style={{
              padding: "var(--space-3)",
              background: "var(--tint-bad)",
              border: "1px solid var(--bad)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-strong)",
            }}
          >
            <strong>Warning: Permanent Deletion</strong>
            <p style={{ margin: "var(--space-1) 0 0 0", fontSize: "var(--font-size-sm)" }}>
              This will tear down all state for <code>{character.char_name}</code> on account{" "}
              <code>{character.account}</code>:
            </p>
            <ul style={{ margin: "var(--space-2) 0 0 0", paddingLeft: "var(--space-4)", fontSize: "var(--font-size-sm)" }}>
              <li>
                <strong>Host service:</strong>{" "}
                {preview?.active ? "Active session will be terminated" : "Session stopped"}
              </li>
              <li>
                <strong>Launch roster:</strong> Removed from <code>entry.yaml</code> and dashboard database
              </li>
              <li>
                <strong>Inventory:</strong>{" "}
                {loadingPreview
                  ? "Calculating..."
                  : `${preview?.inventory_items ?? 0} items in inv.db3 will be purged`}
              </li>
              <li>
                <strong>Lich configs:</strong>{" "}
                {loadingPreview
                  ? "Checking..."
                  : preview?.has_configs
                    ? "Configs will be archived to .archived/"
                    : "No config files found"}
              </li>
              <li>
                <strong>Historical logs:</strong>{" "}
                {loadingPreview
                  ? "Checking..."
                  : preview?.has_logs
                    ? "Game logs and scanner logs will be permanently deleted"
                    : "No log files found"}
              </li>
            </ul>
          </div>

          {error && (
            <div
              style={{
                padding: "var(--space-2)",
                background: "var(--tint-bad)",
                border: "1px solid var(--bad)",
                borderRadius: "var(--radius-sm)",
                color: "var(--bad)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              {error}
            </div>
          )}

          <div>
            <Input
              id="delete-totp"
              label="Enter 6-digit 2FA TOTP code to confirm"
              value={totpCode}
              onChange={setTotpCode}
              placeholder="000000"
              required
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
              marginTop: "var(--space-2)",
            }}
          >
            <Button variant="secondary" onClick={onClose} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!totpCode || deleting}
              loading={deleting}
            >
              Delete Character
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
