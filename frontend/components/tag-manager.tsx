import React, { useState, useEffect } from 'react';
import { Tag, fetchTags, createTag, updateTag, deleteTag } from '../api/client';

const TAG_COLORS = [
  '#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

interface TagManagerProps {
  onClose: () => void;
}

export const TagManager: React.FC<TagManagerProps> = ({ onClose }) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const loadTags = async () => {
    try {
      const data = await fetchTags();
      setTags(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTags();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const tag = await createTag(newName.trim(), newColor);
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewColor(TAG_COLORS[0]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await updateTag(id, { name: editName.trim(), color: editColor });
      setTags((prev) =>
        prev.map((t) => t.id === id ? { ...t, name: editName.trim(), color: editColor } : t)
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this tag? It will be removed from all meetings.')) return;
    try {
      await deleteTag(id);
      setTags((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Manage Tags</h2>
        </div>

        {/* Create new tag */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              placeholder="New tag name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              style={{ flex: 1, fontSize: '13px', padding: '6px 8px' }}
            />
            <div style={{ display: 'flex', gap: '2px' }}>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '4px',
                    backgroundColor: c,
                    border: newColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Add
            </button>
          </div>
        </div>

        {/* Tag list */}
        <div style={{ padding: '8px 0', maxHeight: '400px', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
          ) : tags.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>No tags yet</div>
          ) : (
            tags.map((tag) => (
              <div
                key={tag.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {editingId === tag.id ? (
                  <>
                    <input
                      type="text"
                      className="form-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(tag.id); if (e.key === 'Escape') setEditingId(null); }}
                      autoFocus
                      style={{ flex: 1, fontSize: '12px', padding: '4px 6px' }}
                    />
                    <div style={{ display: 'flex', gap: '2px' }}>
                      {TAG_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '3px',
                            backgroundColor: c,
                            border: editColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        />
                      ))}
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => handleUpdate(tag.id)}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="tag-badge"
                      style={{ backgroundColor: tag.color + '20', color: tag.color, borderColor: tag.color + '40' }}
                    >
                      {tag.name}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: 'auto' }}>
                      {tag.meetingCount} meetings
                    </span>
                    <button
                      className="btn-icon"
                      title="Edit tag"
                      onClick={() => startEdit(tag)}
                      style={{ fontSize: '12px' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-icon btn-icon-danger"
                      title="Delete tag"
                      onClick={() => handleDelete(tag.id)}
                    >
                      x
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
