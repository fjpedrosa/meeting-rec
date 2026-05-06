import React from 'react';
import type {
  MeetingParticipant,
  StructuredTranscript,
  StructuredTranscriptSegment,
} from '../api/client';

interface TranscriptionViewProps {
  transcription: string;
  participants: MeetingParticipant[];
  structuredTranscript?: StructuredTranscript | null;
}

interface ParsedSegment {
  speaker: string;
  text: string;
  timestamp?: string;
}

interface DisplaySegment {
  speaker: string;
  text: string;
  timestamp?: string;
  start?: number;
  end?: number;
  speakerConfidence?: number | null;
  hasOverlap: boolean;
  isStructured: boolean;
}

const parseTranscription = (text: string): ParsedSegment[] => {
  const segments: ParsedSegment[] = [];
  const blocks = text.split(/\n\n+/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    if (lines.length < 2) continue;

    const headerLine = lines[0] ?? '';
    const headerMatch = headerLine.match(/^(.+?)\s*\|\s*(\d{2}:\d{2}:\d{2})$/);
    if (headerMatch) {
      const speaker = headerMatch[1] ?? 'Unknown';
      const timestamp = headerMatch[2] ?? undefined;
      segments.push({
        speaker: speaker.trim(),
        timestamp,
        text: lines.slice(1).join(' ').trim(),
      });
      continue;
    }

    const previous = segments[segments.length - 1];
    if (previous) {
      previous.text = `${previous.text} ${trimmed}`.trim();
    } else {
      segments.push({ speaker: 'Unknown', text: trimmed });
    }
  }

  return segments;
};

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

const getSpeakerDisplayName = (
  speakerLabel: string,
  participants: MeetingParticipant[],
): string => {
  const participant = participants.find(
    (p) => (
      p.speakerLabel.toLowerCase() === speakerLabel.toLowerCase() ||
      p.speakerLabel.replace(/_/g, ' ').toLowerCase() === speakerLabel.toLowerCase()
    ),
  );

  if (participant && participant.isIdentified && participant.profileName) {
    return participant.profileName;
  }

  return speakerLabel;
};

const formatTimestamp = (seconds: number): string => {
  const totalSeconds = Math.max(0, seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${Math.floor(millis / 100)}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${Math.floor(millis / 100)}`;
};

const formatConfidence = (confidence?: number | null): string | null => {
  if (confidence == null || Number.isNaN(confidence)) {
    return null;
  }
  return `${Math.round(confidence * 100)}%`;
};

const buildStructuredSegments = (
  structuredTranscript: StructuredTranscript,
): DisplaySegment[] => {
  return structuredTranscript.segments.map((segment: StructuredTranscriptSegment) => ({
    speaker: segment.speaker_label,
    text: segment.text,
    start: segment.start,
    end: segment.end,
    speakerConfidence: segment.speaker_confidence,
    hasOverlap: segment.has_overlap,
    isStructured: true,
  }));
};

const buildFallbackSegments = (transcription: string): DisplaySegment[] => {
  return parseTranscription(transcription).map((segment) => ({
    speaker: segment.speaker,
    text: segment.text,
    timestamp: segment.timestamp,
    hasOverlap: false,
    isStructured: false,
  }));
};

export const TranscriptionView: React.FC<TranscriptionViewProps> = ({
  transcription,
  participants,
  structuredTranscript,
}) => {
  const segments = (
    structuredTranscript && structuredTranscript.segments.length > 0
      ? buildStructuredSegments(structuredTranscript)
      : buildFallbackSegments(transcription)
  );

  if (segments.length === 0) {
    return (
      <div className="transcription">
        <div className="empty-state">
          <div className="empty-state-title">No transcription available</div>
          <p>The transcription for this meeting is empty or could not be parsed.</p>
        </div>
      </div>
    );
  }

  const overlapCount = segments.filter((segment) => segment.hasOverlap).length;
  const confidenceValues = segments
    .map((segment) => segment.speakerConfidence)
    .filter((value): value is number => value != null && !Number.isNaN(value));
  const averageConfidence = confidenceValues.length > 0
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100)
    : null;

  return (
    <div className="transcription">
      {structuredTranscript && (
        <div className="transcription-summary">
          <span className="transcription-summary-item">
            {segments.length} segments
          </span>
          <span className="transcription-summary-item">
            {overlapCount} overlap
          </span>
          {averageConfidence != null && (
            <span className="transcription-summary-item">
              Avg confidence {averageConfidence}%
            </span>
          )}
        </div>
      )}

      {segments.map((segment, index) => {
        const colorIndex = getSpeakerColorIndex(segment.speaker);
        const displayName = getSpeakerDisplayName(segment.speaker, participants);
        const confidence = formatConfidence(segment.speakerConfidence);

        return (
          <div
            key={`${segment.speaker}-${segment.start ?? segment.timestamp ?? index}-${index}`}
            className={`transcription-segment speaker-${colorIndex}${segment.hasOverlap ? ' transcription-segment-overlap' : ''}`}
          >
            <div className={`transcription-speaker speaker-${colorIndex}`}>
              <span>{displayName}</span>
              {segment.timestamp && (
                <span className="transcription-time">{segment.timestamp}</span>
              )}
              {segment.isStructured && segment.start != null && (
                <span className="transcription-time">
                  {formatTimestamp(segment.start)}
                  {segment.end != null ? ` - ${formatTimestamp(segment.end)}` : ''}
                </span>
              )}
              {segment.hasOverlap && (
                <span className="transcription-badge transcription-badge-overlap">
                  Overlap
                </span>
              )}
              {confidence && (
                <span className="transcription-badge transcription-badge-confidence">
                  {confidence}
                </span>
              )}
            </div>
            <div className="transcription-text">{segment.text}</div>
          </div>
        );
      })}
    </div>
  );
};
