import React, { useState, useEffect } from 'react';
import { Profile, fetchProfiles, createProfile } from '../api/client';
import { ProfileCard } from '../components/profile-card';

interface ProfilesPageProps {
  onNavigate: (hash: string) => void;
}

interface CreateProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (profile: Profile) => void;
}

const CreateProfileModal: React.FC<CreateProfileModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsCreating(true);
    setError(null);

    try {
      const profile = await createProfile(name.trim(), notes.trim() || undefined);
      onCreated(profile);
      setName('');
      setNotes('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Create Profile</h2>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="error">{error}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="profile-name">
              Name
            </label>
            <input
              id="profile-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter profile name"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="profile-notes">
              Notes (optional)
            </label>
            <input
              id="profile-notes"
              type="text"
              className="form-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this person"
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isCreating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || isCreating}
            >
              {isCreating ? 'Creating...' : 'Create Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const ProfilesPage: React.FC<ProfilesPageProps> = ({ onNavigate }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadProfiles = async () => {
    try {
      const data = await fetchProfiles();
      // Sort by name
      data.sort((a, b) => a.name.localeCompare(b.name));
      setProfiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleProfileCreated = (profile: Profile) => {
    setProfiles((prev) => [...prev, profile].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleProfileDeleted = (profileId: number) => {
    setProfiles((prev) => prev.filter((p) => p.id !== profileId));
  };

  const handleProfileRenamed = (profileId: number, newName: string) => {
    setProfiles((prev) =>
      prev.map((p) => p.id === profileId ? { ...p, name: newName } : p)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  const handleReassigned = () => {
    loadProfiles();
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        Loading profiles...
      </div>
    );
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Voice Profiles</h1>
          <p className="page-subtitle">{profiles.length} profiles registered</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          + New Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No profiles yet</div>
          <p>Create your first voice profile to start identifying speakers.</p>
          <button
            className="btn btn-primary mt-lg"
            onClick={() => setIsModalOpen(true)}
          >
            Create Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              allProfiles={profiles}
              onDeleted={handleProfileDeleted}
              onRenamed={handleProfileRenamed}
              onProfileCreated={handleProfileCreated}
              onReassigned={handleReassigned}
            />
          ))}
        </div>
      )}

      <CreateProfileModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={handleProfileCreated}
      />
    </div>
  );
};
