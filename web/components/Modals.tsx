interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, message, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal show" id="confirmModal">
      <div className="modal-content">
        <h3 id="confirmTitle">{title}</h3>
        <p id="confirmMessage">{message}</p>
        <div className="modal-actions">
          <button className="btn-danger" id="confirmYes" onClick={onConfirm} type="button">
            Yes
          </button>
          <button className="btn-secondary" id="confirmNo" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface MetadataModalProps {
  open: boolean;
  filename: string;
  description: string;
  onChangeDescription: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function MetadataModal({
  open,
  filename,
  description,
  onChangeDescription,
  onSave,
  onCancel
}: MetadataModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal show" id="editMetadataModal">
      <div className="modal-content">
        <h3>Edit Disk Metadata</h3>
        <div className="form-group">
          <label htmlFor="metadataFilename">Filename:</label>
          <input type="text" id="metadataFilename" value={filename} readOnly />
        </div>
        <div className="form-group">
          <label htmlFor="metadataDescription">Description:</label>
          <textarea
            id="metadataDescription"
            rows={3}
            value={description}
            onChange={(e) => onChangeDescription(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="btn-primary" onClick={onSave} type="button">
            Save
          </button>
          <button className="btn-secondary" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
