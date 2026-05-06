import React, { useState } from 'react';
import { Profile, UnknownSpeaker, assignSpeakerToProfile, createProfileFromSpeaker, discardSpeaker, formatDate } from '../api/client';
import { AudioPlayer } from './audio-player';

interface SpeakerAssignmentProps {
  speaker: UnknownSpeaker;
  profiles: Profile[];
  onAssigned: () => void;
}

export const SpeakerAssignment: React.FC<SpeakerAssignmentProps> = ({
  speaker,
  profiles,
  onAssigned,
}) => {
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [newProfileName, setNewProfileName] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAssign = async () => {
    if (!selectedProfileId) return;

    setIsAssigning(true);
    setError(null);

    try {
      await assignSpeakerToProfile(speaker.id, parseInt(selectedProfileId, 10));
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign speaker');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsCreating(true);
    setError(null);

    try {
      await createProfileFromSpeaker(speaker.id, newProfileName.trim());
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="unknown-speaker-item">
      <div className="unknown-speaker-header">
        <div>
          <div className="unknown-speaker-label">{speaker.speakerLabel}</div>
          <div className="unknown-speaker-meeting">
            {speaker.meeting.folderName} - {speaker.meeting.meetingDate ? formatDate(speaker.meeting.meetingDate) : 'Unknown date'}
          </div>
        </div>
        <span className={`status status-${speaker.status}`}>{speaker.status}</span>
      </div>

      {speaker.clipPath && <AudioPlayer clipPath={speaker.clipPath} label="Voice sample" />}

      {error && <div className="error mt-md">{error}</div>}

      <div className="unknown-speaker-actions">
        <div className="unknown-speaker-action">
          <select
            className="form-select"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            style={{ width: '200px' }}
          >
            <option value="">Select profile...</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={handleAssign}
            disabled={!selectedProfileId || isAssigning}
          >
            {isAssigning ? 'Assigning...' : 'Assign'}
          </button>
        </div>

        <div className="unknown-speaker-action">
          <input
            type="text"
            className="form-input"
            placeholder="New profile name"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateProfile();
            }}
            style={{ width: '200px' }}
          />
          <button
            className="btn btn-primary"
            onClick={handleCreateProfile}
            disabled={!newProfileName.trim() || isCreating}
          >
            {isCreating ? 'Creating...' : 'Create Profile'}
          </button>
        </div>

        <div className="unknown-speaker-action">
          <button
            className="btn btn-danger"
            onClick={async () => {
              setIsDiscarding(true);
              setError(null);
              try {
                await discardSpeaker(speaker.id);
                onAssigned();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to discard');
              } finally {
                setIsDiscarding(false);
              }
            }}
            disabled={isDiscarding}
          >
            {isDiscarding ? 'Discarding...' : 'Discard (bad audio)'}
          </button>
        </div>
      </div>
    </div>
  );
};
