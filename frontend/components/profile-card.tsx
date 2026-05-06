import React, { useState, useEffect, useRef } from 'react';
import { Profile, ProfileSample, fetchProfileSamples, deleteProfile, reassignSample, createProfile, updateProfile, formatDate } from '../api/client';
import { AudioPlayer } from './audio-player';

interface ProfileCardProps {
  profile: Profile;
  allProfiles: Profile[];
  onDeleted: (profileId: number) => void;
  onRenamed: (profileId: number, newName: string) => void;
  onProfileCreated: (profile: Profile) => void;
  onReassigned: () => void;
  onClick?: (profile: Profile) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  allProfiles,
  onDeleted,
  onRenamed,
  onProfileCreated,
  onReassigned,
  onClick,
}) => {
  const [samples, setSamples] = useState<ProfileSample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reassign state — key: `${source}-${id}`
  const [reassigningKey, setReassigningKey] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>('');
  const [creatingNewProfile, setCreatingNewProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isReassigning, setIsReassigning] = useState(false);

  // Context menu
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && samples.length === 0 && profile.sampleCount > 0) {
      setLoadingSamples(true);
      fetchProfileSamples(profile.id)
        .then(setSamples)
        .catch(() => {})
        .finally(() => setLoadingSamples(false));
    }
  }, [expanded]);

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpenKey) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenKey(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpenKey]);

  // Focus input when editing name starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteProfile(profile.id);
      onDeleted(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const startEditingName = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(profile.name);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === profile.name) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    setError(null);
    try {
      await updateProfile(profile.id, { name: trimmed });
      onRenamed(profile.id, trimmed);
      setIsEditingName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename profile');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveName();
    if (e.key === 'Escape') setIsEditingName(false);
  };

  const openReassign = (key: string) => {
    setMenuOpenKey(null);
    setReassigningKey(key);
    setReassignTargetId('');
    setCreatingNewProfile(false);
    setNewProfileName('');
  };

  const cancelReassign = () => {
    setReassigningKey(null);
    setReassignTargetId('');
    setCreatingNewProfile(false);
    setNewProfileName('');
  };

  const handleReassignTargetChange = (val: string) => {
    if (val === '__create_new__') {
      setCreatingNewProfile(true);
      setReassignTargetId('');
    } else {
      setCreatingNewProfile(false);
      setReassignTargetId(val);
    }
  };

  const handleReassign = async (sample: ProfileSample) => {
    if (!reassignTargetId) return;
    setIsReassigning(true);
    setError(null);
    try {
      await reassignSample(sample.id, parseInt(reassignTargetId, 10), sample.source);
      const updated = await fetchProfileSamples(profile.id);
      setSamples(updated);
      cancelReassign();
      onReassigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign sample');
    } finally {
      setIsReassigning(false);
    }
  };

  const handleCreateAndReassign = async (sample: ProfileSample) => {
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    setIsReassigning(true);
    setError(null);
    try {
      const created = await createProfile(trimmed);
      onProfileCreated(created);
      await reassignSample(sample.id, created.id, sample.source);
      const updated = await fetchProfileSamples(profile.id);
      setSamples(updated);
      cancelReassign();
      onReassigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile and reassign');
    } finally {
      setIsReassigning(false);
    }
  };

  const otherProfiles = allProfiles.filter((p) => p.id !== profile.id);

  return (
    <div
      className="profile-card"
      onClick={onClick ? () => onClick(profile) : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default', position: 'relative' }}
    >
      {/* Delete button */}
      <button
        className="btn btn-danger btn-sm"
        style={{ position: 'absolute', top: '8px', right: '8px', padding: '2px 8px', fontSize: '12px' }}
        onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
        disabled={isDeleting}
        title="Delete profile"
      >
        ✕
      </button>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="modal-overlay"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
          style={{ zIndex: 1000 }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete "{profile.name}"?</h2>
            </div>
            <p style={{ marginBottom: '16px' }}>
              This will remove the profile and revert all transcripts back to speaker labels.
              Voice samples will return to "pending" for reassignment.
            </p>
            {error && <div className="error" style={{ marginBottom: '8px' }}>{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)} disabled={isDeleting}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile name — inline editing */}
      <div className="profile-name-container">
        {isEditingName ? (
          <>
            <input
              ref={nameInputRef}
              className="profile-name-edit"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={handleSaveName}
              disabled={isSavingName}
              onClick={(e) => e.stopPropagation()}
            />
          </>
        ) : (
          <>
            <span className="profile-name">{profile.name}</span>
            <button
              className="btn-icon"
              style={{ fontSize: '13px', flexShrink: 0 }}
              title="Rename profile"
              onClick={startEditingName}
            >
              ✎
            </button>
          </>
        )}
      </div>

      <div className="profile-stats">
        <div className="profile-stat">
          <div className="profile-stat-value">{profile.sampleCount}</div>
          <div className="profile-stat-label">Voice samples</div>
        </div>
        <div className="profile-stat">
          <div className="profile-stat-value">{profile.meetingCount}</div>
          <div className="profile-stat-label">Meetings</div>
        </div>
        <div className="profile-stat">
          <div
            className="profile-stat-value"
            style={{
              color: profile.confidence === 0
                ? undefined
                : profile.confidence >= 80
                  ? 'var(--success)'
                  : profile.confidence >= 50
                    ? 'var(--warning)'
                    : 'var(--error)',
            }}
          >
            {profile.confidence === 0 ? 'N/A' : `${profile.confidence}%`}
          </div>
          <div className="profile-stat-label">Confidence</div>
        </div>
      </div>

      {profile.notes && (
        <div className="profile-notes">{profile.notes}</div>
      )}

      {profile.sampleCount > 0 && (
        <div className="profile-samples-section">
          <button
            className="btn btn-secondary btn-sm"
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => !prev); }}
            style={{ width: '100%', marginTop: '8px' }}
          >
            {expanded ? 'Hide samples' : 'Listen to samples'}
          </button>

          {expanded && (
            <div className="profile-samples" style={{ marginTop: '8px' }} onClick={(e) => e.stopPropagation()}>
              {loadingSamples ? (
                <div className="text-sm text-muted">Loading samples...</div>
              ) : samples.length === 0 ? (
                <div className="text-sm text-muted">No audio clips available</div>
              ) : (
                samples.map((sample) => {
                  const key = `${sample.source}-${sample.id}`;
                  const isReassigningThis = reassigningKey === key;
                  const isMenuOpen = menuOpenKey === key;

                  return (
                    <div key={key} className="sample-row">
                      <div className="sample-row-header">
                        <AudioPlayer
                          clipPath={sample.clipPath}
                          label={sample.meetingDate ? formatDate(sample.meetingDate) : sample.folderName}
                        />
                        <div style={{ position: 'relative' }} ref={isMenuOpen ? menuRef : undefined}>
                          <button
                            className="btn-icon"
                            style={{ fontSize: '16px', flexShrink: 0 }}
                            title="Options"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenKey(isMenuOpen ? null : key);
                            }}
                          >
                            ⋮
                          </button>
                          {isMenuOpen && (
                            <div className="sample-context-menu">
                              <div
                                className="sample-context-menu-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openReassign(key);
                                }}
                              >
                                Reassign to another profile
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {isReassigningThis && (
                        <div style={{ marginTop: '6px' }}>
                          {!creatingNewProfile ? (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <select
                                className="form-select"
                                value={reassignTargetId}
                                onChange={(e) => handleReassignTargetChange(e.target.value)}
                                style={{ flex: 1, fontSize: '12px' }}
                              >
                                <option value="">Move to...</option>
                                {otherProfiles.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                                <option value="__create_new__">+ Create new profile...</option>
                              </select>
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ fontSize: '12px', padding: '2px 8px' }}
                                onClick={() => handleReassign(sample)}
                                disabled={!reassignTargetId || isReassigning}
                              >
                                Move
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '12px', padding: '2px 8px' }}
                                onClick={cancelReassign}
                                disabled={isReassigning}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <input
                                className="form-input"
                                style={{ flex: 1, fontSize: '12px' }}
                                placeholder="New profile name..."
                                value={newProfileName}
                                onChange={(e) => setNewProfileName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newProfileName.trim()) handleCreateAndReassign(sample);
                                  if (e.key === 'Escape') cancelReassign();
                                }}
                                autoFocus
                              />
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ fontSize: '12px', padding: '2px 8px', whiteSpace: 'nowrap' }}
                                onClick={() => handleCreateAndReassign(sample)}
                                disabled={!newProfileName.trim() || isReassigning}
                              >
                                Create & Move
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '12px', padding: '2px 8px' }}
                                onClick={cancelReassign}
                                disabled={isReassigning}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {error && <div className="error mt-sm">{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
