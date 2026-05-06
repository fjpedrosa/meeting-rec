import React, { useState, useEffect } from 'react';
import { UnknownSpeaker, Profile, fetchUnknownSpeakers, fetchProfiles } from '../api/client';
import { SpeakerAssignment } from '../components/speaker-assignment';

interface UnknownSpeakersPageProps {
  onNavigate: (hash: string) => void;
}

export const UnknownSpeakersPage: React.FC<UnknownSpeakersPageProps> = ({ onNavigate }) => {
  const [speakers, setSpeakers] = useState<UnknownSpeaker[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [speakersData, profilesData] = await Promise.all([
        fetchUnknownSpeakers(),
        fetchProfiles(),
      ]);

      // Filter only pending speakers
      const pendingSpeakers = speakersData.filter(
        (s) => s.status === 'pending'
      );

      // Sort by meeting date descending
      pendingSpeakers.sort(
        (a, b) =>
          new Date(b.meeting?.meetingDate || 0).getTime() - new Date(a.meeting?.meetingDate || 0).getTime()
      );

      setSpeakers(pendingSpeakers);
      setProfiles(profilesData.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSpeakerAssigned = () => {
    // Reload the data to reflect the changes
    loadData();
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        Loading unknown speakers...
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
          <h1 className="page-title">Unknown Speakers</h1>
          <p className="page-subtitle">
            {speakers.length} speakers pending identification
          </p>
        </div>
      </div>

      {speakers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">All caught up!</div>
          <p>There are no unknown speakers pending identification.</p>
        </div>
      ) : (
        <div>
          {speakers.map((speaker) => (
            <SpeakerAssignment
              key={speaker.id}
              speaker={speaker}
              profiles={profiles}
              onAssigned={handleSpeakerAssigned}
            />
          ))}
        </div>
      )}
    </div>
  );
};
