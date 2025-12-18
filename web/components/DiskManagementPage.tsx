import { useEffect, useMemo, useState } from 'react';
import { ConfirmModal, MetadataModal } from './Modals';
import { DiskMetadata, StartupMount } from '../types';

interface DiskManagementPageProps {
  images: string[];
  metadata: Record<string, DiskMetadata>;
  startupMounts: StartupMount[];
  onRefresh: () => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
  onSaveMetadata: (filename: string, description: string) => Promise<void>;
  onSaveStartupMounts: (mounts: StartupMount[]) => Promise<void>;
}

export function DiskManagementPage({
  images,
  metadata,
  startupMounts,
  onRefresh,
  onUpload,
  onDelete,
  onSaveMetadata,
  onSaveStartupMounts
}: DiskManagementPageProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmFilename, setConfirmFilename] = useState('');
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataFilename, setMetadataFilename] = useState('');
  const [metadataDescription, setMetadataDescription] = useState('');
  const [currentMounts, setCurrentMounts] = useState<StartupMount[]>(startupMounts);

  useEffect(() => {
    setCurrentMounts(startupMounts);
  }, [startupMounts]);

  const cards = useMemo(() => {
    if (images.length === 0) {
      return (
        <p style={{ gridColumn: '1/-1', textAlign: 'center', color: '#6b7280' }}>
          No disk images found. Upload one to get started.
        </p>
      );
    }

    return images.map((filename) => {
      const meta = metadata[filename] || {};
      const sizeKB = meta.size ? (meta.size / 1024).toFixed(1) : '?';
      const description = meta.description || 'No description';
      const uploadDate = meta.uploadDate ? new Date(meta.uploadDate).toLocaleDateString() : 'Unknown';

      return (
        <div key={filename} className="disk-card">
          <div className="disk-card-header">
            <div className="disk-filename">{filename}</div>
            <div className="disk-actions">
              <button
                className="disk-action-btn"
                onClick={() => openMetadata(filename, description)}
                type="button"
                title="Edit"
              >
                ✏️
              </button>
              <button
                className="disk-action-btn delete"
                onClick={() => confirmDelete(filename)}
                type="button"
                title="Delete"
              >
                🗑️
              </button>
            </div>
          </div>
          <div className="disk-description">{description}</div>
          <div className="disk-info">
            <span>{sizeKB} KB</span>
            <span>{uploadDate}</span>
          </div>
        </div>
      );
    });
  }, [images, metadata]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await onUpload(file);
      event.target.value = '';
    }
  };

  const confirmDelete = (filename: string) => {
    setConfirmFilename(filename);
    setConfirmOpen(true);
  };

  const openMetadata = (filename: string, description: string) => {
    setMetadataFilename(filename);
    setMetadataDescription(description === 'No description' ? '' : description);
    setMetadataOpen(true);
  };

  const handleSaveMetadata = async () => {
    await onSaveMetadata(metadataFilename, metadataDescription);
    setMetadataOpen(false);
  };

  const handleStartupChange = (driveId: number, field: 'diskFilename' | 'readonly', value: string | boolean) => {
    setCurrentMounts((prev) =>
      prev.map((mount) => {
        if (mount.driveId === driveId) {
          return {
            ...mount,
            [field]: typeof value === 'string' ? value : value
          } as StartupMount;
        }
        return mount;
      })
    );
  };

  const saveStartupMounts = async () => {
    await onSaveStartupMounts(
      currentMounts.map((mount) => ({
        ...mount,
        diskFilename: mount.diskFilename || null
      }))
    );
  };

  return (
    <div className="page active" id="page-disks">
      <header className="page-header">
        <h1>Disk Management</h1>
        <div className="page-actions">
          <button className="btn-secondary" onClick={onRefresh} type="button">
            Reload
          </button>
          <button className="btn-primary" onClick={() => document.getElementById('diskUpload')?.click()} type="button">
            Upload Disk Image
          </button>
        </div>
        <input
          type="file"
          id="diskUpload"
          style={{ display: 'none' }}
          accept=".dsk,.img,.ima"
          onChange={onFileChange}
        />
      </header>

      <div className="disk-library">
        <h2>Disk Images</h2>
        <div className="disk-grid" id="diskGrid">
          {cards}
        </div>
      </div>

      <div className="startup-mounts-section">
        <h2>Startup Disk Mounts</h2>
        <p className="section-description">
          Configure which disk images should be automatically mounted when the server starts
        </p>
        <div className="mounts-grid">
          {currentMounts.map((mount) => (
            <div className="mount-item" key={mount.driveId}>
              <label>Drive {mount.driveId}:</label>
              <select
                id={`startupMount${mount.driveId}`}
                value={mount.diskFilename || ''}
                onChange={(e) => handleStartupChange(mount.driveId, 'diskFilename', e.target.value)}
              >
                <option value="">None</option>
                {images.map((img) => (
                  <option key={img} value={img}>
                    {img}
                  </option>
                ))}
              </select>
              <label className="readonly-label">
                <input
                  type="checkbox"
                  id={`startupReadonly${mount.driveId}`}
                  checked={mount.readonly}
                  onChange={(e) => handleStartupChange(mount.driveId, 'readonly', e.target.checked)}
                />
                Read-Only
              </label>
            </div>
          ))}
        </div>
        <button className="btn-primary" onClick={saveStartupMounts} type="button">
          Save Startup Mounts
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Delete Disk Image"
        message={`Are you sure you want to delete "${confirmFilename}"? This action cannot be undone.`}
        onConfirm={async () => {
          await onDelete(confirmFilename);
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      <MetadataModal
        open={metadataOpen}
        filename={metadataFilename}
        description={metadataDescription}
        onChangeDescription={setMetadataDescription}
        onSave={handleSaveMetadata}
        onCancel={() => setMetadataOpen(false)}
      />
    </div>
  );
}
