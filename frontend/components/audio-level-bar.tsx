import React from 'react';

interface AudioLevelBarProps {
  level: number; // 0-100
}

export const AudioLevelBar: React.FC<AudioLevelBarProps> = ({ level }) => (
  <div className="audio-level-bar" title={`Audio level: ${Math.round(level)}%`}>
    <div
      className="audio-level-fill"
      style={{ width: `${level}%` }}
    />
  </div>
);
