import React from 'react';
import { getClipUrl } from '../api/client';

interface AudioPlayerProps {
  clipPath: string;
  label?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ clipPath, label }) => {
  const audioUrl = getClipUrl(clipPath);

  return (
    <div className="audio-player">
      {label && <span className="text-sm text-muted">{label}</span>}
      <audio controls preload="none">
        <source src={audioUrl} type="audio/wav" />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
};
