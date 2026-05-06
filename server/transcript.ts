import { existsSync } from "fs";

interface TextTranscriptSegment {
  speaker: string;
  timestamp: string;
  text: string;
}

interface StructuredTranscriptWord {
  speaker_label?: string;
  speaker_display_name?: string;
}

interface StructuredTranscriptSegment {
  speaker_label?: string;
  speaker_display_name?: string;
  words?: StructuredTranscriptWord[];
}

interface StructuredTranscript {
  speakers?: Record<string, { display_name?: string }>;
  segments?: StructuredTranscriptSegment[];
}

const parseTranscriptBlocks = (content: string): TextTranscriptSegment[] => {
  const segments: TextTranscriptSegment[] = [];
  for (const block of content.split(/\n\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");
    if (lines.length < 2) continue;

    const match = lines[0].match(/^(.+?)\s*\|\s*(\d{2}:\d{2}:\d{2})$/);
    if (!match) continue;

    segments.push({
      speaker: match[1].trim(),
      timestamp: match[2],
      text: lines.slice(1).join("\n").trim(),
    });
  }
  return segments;
};

const formatTranscriptBlocks = (segments: TextTranscriptSegment[]): string =>
  segments.map((segment) => `${segment.speaker} | ${segment.timestamp}\n${segment.text}`).join("\n\n");

export const getStructuredTranscriptPath = (transcriptPath: string): string => {
  if (transcriptPath.endsWith(".txt")) {
    return `${transcriptPath.slice(0, -4)}.transcript.json`;
  }
  return `${transcriptPath}.transcript.json`;
};

export const rewriteTranscriptArtifacts = async (
  transcriptPath: string,
  speakerLabel: string,
  oldDisplayName: string,
  newDisplayName: string,
): Promise<void> => {
  const transcriptFile = Bun.file(transcriptPath);
  if (await transcriptFile.exists()) {
    const segments = parseTranscriptBlocks(await transcriptFile.text());
    const updated = segments.map((segment) => ({
      ...segment,
      speaker: (
        segment.speaker === oldDisplayName ||
        segment.speaker === speakerLabel
      )
        ? newDisplayName
        : segment.speaker,
    }));
    await Bun.write(transcriptPath, formatTranscriptBlocks(updated));
  }

  const structuredPath = getStructuredTranscriptPath(transcriptPath);
  if (!existsSync(structuredPath)) {
    return;
  }

  const structuredFile = Bun.file(structuredPath);
  const payload = await structuredFile.json() as StructuredTranscript;

  if (payload.speakers?.[speakerLabel]) {
    payload.speakers[speakerLabel].display_name = newDisplayName;
  }

  for (const segment of payload.segments || []) {
    const shouldRewriteSegment = (
      segment.speaker_label === speakerLabel ||
      segment.speaker_display_name === oldDisplayName
    );
    if (shouldRewriteSegment) {
      segment.speaker_display_name = newDisplayName;
    }

    for (const word of segment.words || []) {
      if (word.speaker_label === speakerLabel || word.speaker_display_name === oldDisplayName) {
        word.speaker_display_name = newDisplayName;
      }
    }
  }

  await Bun.write(structuredPath, JSON.stringify(payload, null, 2));
};
