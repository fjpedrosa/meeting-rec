import { db } from "../db";
import { rewriteTranscriptArtifacts } from "../transcript";

const MIN_PROFILE_IMPORT_QUALITY = 0.25;

// Types for database rows
interface UnknownSpeakerRow {
  id: number;
  meeting_id: number;
  speaker_label: string;
  embedding: Uint8Array | ArrayBuffer | null;
  clip_path: string | null;
  quality_score: number | null;
  clip_duration_seconds: number | null;
  segment_count: number | null;
  clean_segment_count: number | null;
  has_overlap: number;
  assigned_profile_id: number | null;
  status: string;
}

interface UnknownSpeakerWithMeetingRow extends UnknownSpeakerRow {
  folder_name: string;
  meeting_date: string | null;
}

interface MeetingRow {
  id: number;
  transcript_path: string | null;
}

interface ProfileRow {
  id: number;
  name: string;
  created_at: string;
  notes: string | null;
}

// Prepared statements
const listPendingUnknownSpeakersStmt = db.prepare<UnknownSpeakerWithMeetingRow, []>(`
  SELECT
    us.id,
    us.meeting_id,
    us.speaker_label,
    us.embedding,
    us.clip_path,
    us.assigned_profile_id,
    us.status,
    m.folder_name,
    m.meeting_date
  FROM unknown_speakers us
  JOIN meetings m ON us.meeting_id = m.id
  WHERE us.status IN ('pending', 'discarded')
  ORDER BY m.meeting_date DESC, us.speaker_label
`);

const getUnknownSpeakerStmt = db.prepare<UnknownSpeakerRow, [number]>(`
  SELECT
    id, meeting_id, speaker_label, embedding, clip_path,
    quality_score, clip_duration_seconds, segment_count, clean_segment_count, has_overlap,
    assigned_profile_id, status
  FROM unknown_speakers
  WHERE id = ?
`);

const getMeetingStmt = db.prepare<MeetingRow, [number]>(`
  SELECT id, transcript_path
  FROM meetings
  WHERE id = ?
`);

const getProfileStmt = db.prepare<ProfileRow, [number]>(`
  SELECT id, name, created_at, notes
  FROM voice_profiles
  WHERE id = ?
`);

const insertEmbeddingStmt = db.prepare(`
  INSERT INTO voice_embeddings (
    profile_id, embedding, source_meeting_id,
    quality_score, clip_duration_seconds, segment_count, clean_segment_count, has_overlap,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

const updateUnknownSpeakerAssignedStmt = db.prepare(`
  UPDATE unknown_speakers
  SET status = 'assigned', assigned_profile_id = ?
  WHERE id = ?
`);

const updateMeetingParticipantStmt = db.prepare(`
  UPDATE meeting_participants
  SET profile_id = ?, is_identified = 1
  WHERE meeting_id = ? AND speaker_label = ?
`);

const insertProfileStmt = db.prepare<ProfileRow, [string]>(`
  INSERT INTO voice_profiles (name, created_at)
  VALUES (?, datetime('now'))
  RETURNING id, name, created_at, notes
`);

const updateUnknownSpeakerDiscardedStmt = db.prepare(`
  UPDATE unknown_speakers
  SET status = 'discarded'
  WHERE id = ?
`);

const checkProfileNameExistsStmt = db.prepare<{ count: number }, [string]>(`
  SELECT COUNT(*) as count FROM voice_profiles WHERE name = ?
`);

const getEmbeddingBytes = (embedding: Uint8Array | ArrayBuffer): Uint8Array => {
  if (embedding instanceof Uint8Array) {
    return embedding;
  }

  return new Uint8Array(embedding);
};

const isZeroEmbedding = (embedding: Uint8Array | ArrayBuffer): boolean => {
  const bytes = getEmbeddingBytes(embedding);

  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
    if (view.getFloat32(offset, true) !== 0) {
      return false;
    }
  }

  return true;
};

/**
 * GET /api/unknown-speakers
 * List pending unknown speakers with their meeting info
 */
export const handleGetUnknownSpeakers = (req: Request): Response => {
  try {
    const speakers = listPendingUnknownSpeakersStmt.all();

    return Response.json({
      success: true,
      data: speakers.map((s) => ({
        id: s.id,
        meetingId: s.meeting_id,
        speakerLabel: s.speaker_label,
        clipPath: s.clip_path,
        status: s.status,
        meeting: {
          folderName: s.folder_name,
          meetingDate: s.meeting_date,
        },
      })),
      count: speakers.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};

/**
 * POST /api/unknown-speakers/:id/assign
 * Assign unknown speaker to existing profile
 * Body: { profileId: number }
 */
export const handleAssignSpeaker = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/unknown-speakers\/(\d+)\/assign$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid speaker ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const body = await req.json();

    if (!body.profileId || typeof body.profileId !== "number") {
      return Response.json(
        { success: false, error: "profileId is required" },
        { status: 400 }
      );
    }

    const profileId = body.profileId;

    // Get the unknown speaker
    const speaker = getUnknownSpeakerStmt.get(id);
    if (!speaker) {
      return Response.json(
        { success: false, error: "Unknown speaker not found" },
        { status: 404 }
      );
    }

    if (speaker.status === "assigned") {
      return Response.json(
        { success: false, error: "Speaker has already been assigned" },
        { status: 400 }
      );
    }

    // Get the target profile
    const profile = getProfileStmt.get(profileId);
    if (!profile) {
      return Response.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    // Get the meeting for transcript regeneration
    const meeting = getMeetingStmt.get(speaker.meeting_id);
    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    // Execute all database updates in a transaction
    db.transaction(() => {
      // Copy embedding to voice_embeddings only when it is non-zero and comes from a
      // sufficiently clean clip. Manual assignment should not pollute the library.
      if (
        speaker.embedding &&
        !isZeroEmbedding(speaker.embedding) &&
        (speaker.quality_score ?? 0) >= MIN_PROFILE_IMPORT_QUALITY
      ) {
        insertEmbeddingStmt.run(
          profileId,
          speaker.embedding,
          speaker.meeting_id,
          speaker.quality_score,
          speaker.clip_duration_seconds,
          speaker.segment_count,
          speaker.clean_segment_count,
          speaker.has_overlap,
        );
      }

      // Update unknown_speakers status
      updateUnknownSpeakerAssignedStmt.run(profileId, id);

      // Update meeting_participants
      updateMeetingParticipantStmt.run(profileId, speaker.meeting_id, speaker.speaker_label);
    })();

    // Regenerate transcript file if it exists
    if (meeting.transcript_path) {
      try {
        await rewriteTranscriptArtifacts(
          meeting.transcript_path,
          speaker.speaker_label,
          speaker.speaker_label,
          profile.name,
        );
      } catch (transcriptError) {
        // Log but don't fail the request - the DB updates succeeded
        console.error("Failed to regenerate transcript:", transcriptError);
      }
    }

    return Response.json({
      success: true,
      data: {
        id,
        speakerLabel: speaker.speaker_label,
        assignedProfile: {
          id: profile.id,
          name: profile.name,
        },
        status: "assigned",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};

/**
 * POST /api/unknown-speakers/:id/create-profile
 * Create new profile from unknown speaker
 * Body: { name: string }
 */
export const handleCreateProfileFromUnknown = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/unknown-speakers\/(\d+)\/create-profile$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid speaker ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const body = await req.json();

    if (!body.name || typeof body.name !== "string") {
      return Response.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    const name = body.name.trim();
    if (name.length === 0) {
      return Response.json(
        { success: false, error: "Name cannot be empty" },
        { status: 400 }
      );
    }

    // Check for duplicate name
    const existing = checkProfileNameExistsStmt.get(name);
    if (existing && existing.count > 0) {
      return Response.json(
        { success: false, error: "A profile with this name already exists" },
        { status: 409 }
      );
    }

    // Get the unknown speaker
    const speaker = getUnknownSpeakerStmt.get(id);
    if (!speaker) {
      return Response.json(
        { success: false, error: "Unknown speaker not found" },
        { status: 404 }
      );
    }

    if (speaker.status === "assigned") {
      return Response.json(
        { success: false, error: "Speaker has already been assigned" },
        { status: 400 }
      );
    }

    // Get the meeting for transcript regeneration
    const meeting = getMeetingStmt.get(speaker.meeting_id);
    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    let newProfile: ProfileRow | null = null;

    // Execute all database updates in a transaction
    db.transaction(() => {
      // Create the new profile
      newProfile = insertProfileStmt.get(name);

      if (!newProfile) {
        throw new Error("Failed to create profile");
      }

      // Copy embedding to voice_embeddings only when it is non-zero and comes from a
      // sufficiently clean clip. Manual assignment should not pollute the library.
      if (
        speaker.embedding &&
        !isZeroEmbedding(speaker.embedding) &&
        (speaker.quality_score ?? 0) >= MIN_PROFILE_IMPORT_QUALITY
      ) {
        insertEmbeddingStmt.run(
          newProfile.id,
          speaker.embedding,
          speaker.meeting_id,
          speaker.quality_score,
          speaker.clip_duration_seconds,
          speaker.segment_count,
          speaker.clean_segment_count,
          speaker.has_overlap,
        );
      }

      // Update unknown_speakers status
      updateUnknownSpeakerAssignedStmt.run(newProfile.id, id);

      // Update meeting_participants
      updateMeetingParticipantStmt.run(newProfile.id, speaker.meeting_id, speaker.speaker_label);
    })();

    if (!newProfile) {
      return Response.json(
        { success: false, error: "Failed to create profile" },
        { status: 500 }
      );
    }

    // Regenerate transcript file if it exists
    if (meeting.transcript_path) {
      try {
        await rewriteTranscriptArtifacts(
          meeting.transcript_path,
          speaker.speaker_label,
          speaker.speaker_label,
          name,
        );
      } catch (transcriptError) {
        // Log but don't fail the request - the DB updates succeeded
        console.error("Failed to regenerate transcript:", transcriptError);
      }
    }

    return Response.json(
      {
        success: true,
        data: {
          profile: {
            id: newProfile.id,
            name: newProfile.name,
            createdAt: newProfile.created_at,
            notes: newProfile.notes,
          },
          speakerId: id,
          speakerLabel: speaker.speaker_label,
          status: "assigned",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};

/**
 * POST /api/unknown-speakers/:id/discard
 * Mark unknown speaker as discarded (bad diarization, mixed voices, etc.)
 */
export const handleDiscardSpeaker = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/unknown-speakers\/(\d+)\/discard$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid speaker ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const speaker = getUnknownSpeakerStmt.get(id);

    if (!speaker) {
      return Response.json(
        { success: false, error: "Unknown speaker not found" },
        { status: 404 }
      );
    }

    if (speaker.status === "assigned") {
      return Response.json(
        { success: false, error: "Speaker has already been assigned" },
        { status: 400 }
      );
    }

    updateUnknownSpeakerDiscardedStmt.run(id);

    return Response.json({
      success: true,
      data: { id, status: "discarded" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};
