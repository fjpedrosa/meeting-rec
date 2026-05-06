import React, { useState, useEffect } from 'react';
import {
  fetchStructuredTranscription,
  fetchMeeting,
  fetchProfiles,
  fetchTags,
  fetchTranscription,
  updateMeeting,
  rediarizeMeeting,
  assignSpeakerToProfile,
  createProfileFromSpeaker,
  assignTagToMeeting,
  removeTagFromMeeting,
  createTag,
  type MeetingDetail,
  type MeetingParticipant,
  type MeetingTag,
  type Tag,
  type Profile,
  type StructuredTranscript,
  type PipelineMetadata,
  formatDate,
  formatDuration,
} from '../api/client';
import { TranscriptionView } from '../components/transcription-view';

interface MeetingDetailPageProps {
  meetingId: number;
  onNavigate: (hash: string) => void;
}

const getSpeakerColorIndex = (speaker: string): number => {
  const match = speaker.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10) % 8;
  }
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = ((hash << 5) - hash) + speaker.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % 8;
};

interface ParticipantItemProps {
  participant: MeetingParticipant;
  profiles: Profile[];
  meetingId: number;
  onUpdated: () => void;
}

const ParticipantItem: React.FC<ParticipantItemProps> = ({
  participant,
  profiles,
  meetingId,
  onUpdated,
}) => {
  const [editing, setEditing] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const colorIndex = getSpeakerColorIndex(participant.speakerLabel);
  const bgColor = `var(--speaker-${colorIndex})`;
  const clipUrl = participant.clipPath ? `/api/clips/${participant.clipPath}` : null;

  const findUnknownSpeaker = async () => {
    const response = await fetch(`/api/unknown-speakers`);
    const data = await response.json();
    return (data.data as any[])?.find(
      (s: any) => s.speakerLabel === participant.speakerLabel && s.meetingId === meetingId
    ) ?? null;
  };

  const handleAssign = async () => {
    if (!selectedProfileId) return;
    setSaving(true);
    try {
      const unknownSpeaker = await findUnknownSpeaker();
      if (unknownSpeaker) {
        await assignSpeakerToProfile(unknownSpeaker.id, parseInt(selectedProfileId, 10));
      }
      setEditing(false);
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateProfile = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const unknownSpeaker = await findUnknownSpeaker();
      if (unknownSpeaker) {
        await createProfileFromSpeaker(unknownSpeaker.id, newName.trim());
      }
      setEditing(false);
      setNewName('');
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const displayName = participant.isIdentified && participant.profileName
    ? participant.profileName
    : null;

  return (
    <li className="participant-item">
      <div className="participant-indicator" style={{ backgroundColor: bgColor }} />
      <div className="participant-info" style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {displayName ? (
            <div className="participant-name">{displayName}</div>
          ) : (
            <div
              className="participant-name participant-unknown"
              style={{ cursor: 'pointer' }}
              onClick={() => setEditing(!editing)}
            >
              Unknown (click to assign)
            </div>
          )}
          {clipUrl && (
            <audio
              src={clipUrl}
              controls
              style={{ height: '24px', maxWidth: '140px' }}
              title={`${participant.speakerLabel} voice sample`}
            />
          )}
          {displayName && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '10px', padding: '2px 6px' }}
              onClick={() => setEditing(!editing)}
              title="Re-assign speaker"
            >
              Re-assign
            </button>
          )}
        </div>

        {editing && (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <select
                className="form-select"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                style={{ flex: 1, fontSize: '12px', padding: '4px' }}
              >
                <option value="">Existing profile...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 8px' }}
                onClick={handleAssign}
                disabled={!selectedProfileId || saving}
              >
                OK
              </button>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="New profile name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProfile(); }}
                style={{ flex: 1, fontSize: '12px', padding: '4px' }}
              />
              <button
                className="btn btn-primary"
                style={{ fontSize: '11px', padding: '4px 8px' }}
                onClick={handleCreateProfile}
                disabled={!newName.trim() || saving}
              >
                Create
              </button>
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '10px', padding: '2px 6px', alignSelf: 'flex-start' }}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        )}

        <div className="participant-label">{participant.speakerLabel}</div>
      </div>
    </li>
  );
};

const PipelineInfoCard: React.FC<{ pipeline: PipelineMetadata }> = ({ pipeline }) => (
  <div className="card" style={{ marginTop: '16px' }}>
    <div className="card-header">
      <h2 className="card-title">Pipeline info</h2>
    </div>
    <div style={{ padding: '12px 16px', fontSize: '13px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Models</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            <div>Transcription: <code>{pipeline.transcription_model}</code></div>
            <div>Diarization: <code>{pipeline.diarization_model}</code></div>
            <div>Embeddings: <code>{pipeline.embedding_model}</code></div>
            <div>Device: <code>{pipeline.diarization_device}</code></div>
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Identification</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            <div>Match threshold: {pipeline.identification.match_score_threshold}</div>
            <div>Exemplar threshold: {pipeline.identification.best_exemplar_distance_threshold}</div>
            <div>Min quality: {pipeline.identification.min_quality_score}</div>
            <div>Confidence margin: {pipeline.identification.confidence_margin}</div>
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Segmentation</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            <div>Word overlap ratio: {pipeline.segmentation.min_word_overlap_ratio}</div>
            <div>Overlap ratio: {pipeline.segmentation.overlap_word_ratio}</div>
            <div>Max gap to merge: {pipeline.segmentation.max_word_gap_to_merge}s</div>
          </div>
        </div>
        {pipeline.processed_at && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
            Processed: {new Date(pipeline.processed_at).toLocaleString('es-ES')}
          </div>
        )}
      </div>
    </div>
  </div>
);

export const MeetingDetailPage: React.FC<MeetingDetailPageProps> = ({
  meetingId,
  onNavigate,
}) => {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [structuredTranscript, setStructuredTranscript] = useState<StructuredTranscript | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [rediarizing, setRediarizing] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [meetingData, transcriptionData, profilesData, structuredTranscriptData, tagsData] = await Promise.all([
        fetchMeeting(meetingId),
        fetchTranscription(meetingId),
        fetchProfiles(),
        fetchStructuredTranscription(meetingId).catch(() => null),
        fetchTags(),
      ]);
      setMeeting(meetingData);
      setTranscription(transcriptionData);
      setStructuredTranscript(structuredTranscriptData);
      setProfiles(profilesData);
      setAllTags(tagsData);
      setTitleDraft(meetingData.title || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meeting');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [meetingId]);

  const handleSaveTitle = async () => {
    if (!meeting) return;
    try {
      await updateMeeting(meetingId, { title: titleDraft.trim() || undefined });
      setMeeting({ ...meeting, title: titleDraft.trim() || null });
      setEditingTitle(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleParticipantUpdated = async () => {
    // Reload meeting + transcription to reflect changes
    try {
      const [meetingData, transcriptionData, structuredTranscriptData] = await Promise.all([
        fetchMeeting(meetingId),
        fetchTranscription(meetingId),
        fetchStructuredTranscription(meetingId).catch(() => null),
      ]);
      setMeeting(meetingData);
      setTranscription(transcriptionData);
      setStructuredTranscript(structuredTranscriptData);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRediarize = async () => {
    if (!meeting || !confirm('This will re-process the entire meeting. Continue?')) return;
    setRediarizing(true);
    try {
      await rediarizeMeeting(meetingId);
      onNavigate('#/');
    } catch (err) {
      console.error(err);
      setRediarizing(false);
    }
  };

  const handleAssignTag = async (tagId: number) => {
    if (!meeting) return;
    try {
      await assignTagToMeeting(meetingId, tagId);
      const tag = allTags.find((t) => t.id === tagId);
      if (tag) {
        setMeeting({
          ...meeting,
          tags: [...(meeting.tags || []), { id: tag.id, name: tag.name, color: tag.color }],
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!meeting) return;
    try {
      await removeTagFromMeeting(meetingId, tagId);
      setMeeting({
        ...meeting,
        tags: (meeting.tags || []).filter((t) => t.id !== tagId),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateAndAssignTag = async () => {
    if (!meeting || !newTagName.trim()) return;
    try {
      const tag = await createTag(newTagName.trim());
      setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      await assignTagToMeeting(meetingId, tag.id);
      setMeeting({
        ...meeting,
        tags: [...(meeting.tags || []), { id: tag.id, name: tag.name, color: tag.color }],
      });
      setNewTagName('');
      setAddingTag(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleBack = () => {
    onNavigate('#/');
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        Loading meeting...
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <a href="#/" className="back-link" onClick={(e) => { e.preventDefault(); handleBack(); }}>
          ← Back to meetings
        </a>
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div>
        <a href="#/" className="back-link" onClick={(e) => { e.preventDefault(); handleBack(); }}>
          ← Back to meetings
        </a>
        <div className="empty-state">
          <div className="empty-state-title">Meeting not found</div>
        </div>
      </div>
    );
  }

  const identifiedCount = meeting.participants.filter(p => p.isIdentified).length;
  const unknownCount = meeting.participants.length - identifiedCount;
  const displayTitle = meeting.title || meeting.folder_name;

  return (
    <div>
      <a href="#/" className="back-link" onClick={(e) => { e.preventDefault(); handleBack(); }}>
        ← Back to meetings
      </a>

      <div className="page-header">
        {editingTitle ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
            <input
              type="text"
              className="form-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              placeholder="Meeting title..."
              autoFocus
              style={{ flex: 1, fontSize: '18px' }}
            />
            <button className="btn btn-primary" onClick={handleSaveTitle}>Save</button>
            <button className="btn btn-secondary" onClick={() => setEditingTitle(false)}>Cancel</button>
          </div>
        ) : (
          <h1
            className="page-title"
            style={{ cursor: 'pointer' }}
            onClick={() => { setTitleDraft(meeting.title || ''); setEditingTitle(true); }}
            title="Click to edit title"
          >
            {displayTitle}
          </h1>
        )}
      </div>

      <div className="meeting-info">
        <div className="meeting-info-item">
          <span className="meeting-info-label">Date</span>
          <span className="meeting-info-value">{formatDate(meeting.meeting_date)}</span>
        </div>
        <div className="meeting-info-item">
          <span className="meeting-info-label">Duration</span>
          <span className="meeting-info-value font-mono">
            {formatDuration(meeting.duration_seconds)}
          </span>
        </div>
        <div className="meeting-info-item">
          <span className="meeting-info-label">Language</span>
          <span className="meeting-info-value">{meeting.language.toUpperCase()}</span>
        </div>
        <div className="meeting-info-item">
          <span className="meeting-info-label">Status</span>
          <span className={`status status-${meeting.status}`}>{meeting.status}</span>
        </div>
      </div>

      {meeting.status === 'error' && meeting.error_message && (
        <div className="error-banner">
          <strong>Pipeline error:</strong>
          <pre className="error-details">{meeting.error_message}</pre>
        </div>
      )}

      {meeting.status === 'completed' && (
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
          {transcription && (
            <a
              href={`/api/meetings/${meetingId}/transcription/download`}
              download
              className="btn btn-secondary"
            >
              Download transcription
            </a>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleRediarize}
            disabled={rediarizing}
          >
            {rediarizing ? 'Re-diarizing...' : 'Re-diarize'}
          </button>
        </div>
      )}

      <div className="meeting-layout">
        <div className="meeting-main">
          <TranscriptionView
            transcription={transcription}
            participants={meeting.participants}
            structuredTranscript={structuredTranscript}
          />
        </div>

        <div className="meeting-sidebar">
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Participants</h2>
                <p className="card-subtitle">
                  {identifiedCount} identified, {unknownCount} unknown
                </p>
              </div>
            </div>
            <ul className="participant-list">
              {meeting.participants.map((participant) => (
                <ParticipantItem
                  key={participant.speakerLabel}
                  participant={participant}
                  profiles={profiles}
                  meetingId={meetingId}
                  onUpdated={handleParticipantUpdated}
                />
              ))}
            </ul>
          </div>

          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-header">
              <h2 className="card-title">Tags</h2>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {meeting.tags && meeting.tags.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {meeting.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="tag-badge"
                      style={{ backgroundColor: tag.color + '20', color: tag.color, borderColor: tag.color + '40' }}
                    >
                      {tag.name}
                      <button
                        className="tag-remove"
                        onClick={() => handleRemoveTag(tag.id)}
                        title="Remove tag"
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '10px' }}>No tags assigned</p>
              )}

              {(() => {
                const assignedIds = new Set((meeting.tags || []).map((t) => t.id));
                const available = allTags.filter((t) => !assignedIds.has(t.id));
                return available.length > 0 ? (
                  <select
                    className="form-select"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) handleAssignTag(parseInt(e.target.value, 10));
                    }}
                    style={{ fontSize: '12px', width: '100%', marginBottom: '6px' }}
                  >
                    <option value="">Add existing tag...</option>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : null;
              })()}

              {addingTag ? (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Tag name..."
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAssignTag(); if (e.key === 'Escape') setAddingTag(false); }}
                    autoFocus
                    style={{ flex: 1, fontSize: '12px', padding: '4px 6px' }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={handleCreateAndAssignTag}
                    disabled={!newTagName.trim()}
                  >
                    Create
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={() => { setAddingTag(false); setNewTagName(''); }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '11px', padding: '4px 8px', width: '100%' }}
                  onClick={() => setAddingTag(true)}
                >
                  + New tag
                </button>
              )}
            </div>
          </div>

          {structuredTranscript?.pipeline && (
            <PipelineInfoCard pipeline={structuredTranscript.pipeline} />
          )}
        </div>
      </div>
    </div>
  );
};
