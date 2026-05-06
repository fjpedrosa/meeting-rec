import { db } from "../db";
import { rewriteTranscriptArtifacts } from "../transcript";

// Types for database rows
interface ProfileRow {
  id: number;
  name: string;
  created_at: string;
  notes: string | null;
}

interface ProfileWithCountsRow extends ProfileRow {
  embedding_count: number;
  meeting_count: number;
  sample_count: number;
  avg_quality: number | null;
}

interface ProfileMeetingRow {
  meeting_id: number;
  folder_name: string;
  meeting_date: string | null;
  speaker_label: string;
}

// Prepared statements
const listProfilesStmt = db.prepare<ProfileWithCountsRow, []>(`
  SELECT
    vp.id,
    vp.name,
    vp.created_at,
    vp.notes,
    COUNT(DISTINCT ve.id) as embedding_count,
    COUNT(DISTINCT mp.meeting_id) as meeting_count,
    (
      SELECT COUNT(*) FROM unknown_speakers us
      WHERE us.assigned_profile_id = vp.id AND us.status = 'assigned' AND us.clip_path IS NOT NULL
    ) + (
      SELECT COUNT(*) FROM meeting_participants mp2
      WHERE mp2.profile_id = vp.id AND mp2.is_identified = 1 AND mp2.clip_path IS NOT NULL
    ) as sample_count,
    AVG(ve.quality_score) as avg_quality
  FROM voice_profiles vp
  LEFT JOIN voice_embeddings ve ON vp.id = ve.profile_id
  LEFT JOIN meeting_participants mp ON vp.id = mp.profile_id
  GROUP BY vp.id
  ORDER BY vp.name
`);

const getProfileStmt = db.prepare<ProfileRow, [number]>(`
  SELECT id, name, created_at, notes
  FROM voice_profiles
  WHERE id = ?
`);

const getProfileMeetingsStmt = db.prepare<ProfileMeetingRow, [number]>(`
  SELECT
    m.id as meeting_id,
    m.folder_name,
    m.meeting_date,
    mp.speaker_label
  FROM meeting_participants mp
  JOIN meetings m ON mp.meeting_id = m.id
  WHERE mp.profile_id = ?
  ORDER BY m.meeting_date DESC
`);

const insertProfileStmt = db.prepare<ProfileRow, [string, string | null]>(`
  INSERT INTO voice_profiles (name, notes, created_at)
  VALUES (?, ?, datetime('now'))
  RETURNING id, name, created_at, notes
`);

const checkProfileNameExistsStmt = db.prepare<{ count: number }, [string]>(`
  SELECT COUNT(*) as count FROM voice_profiles WHERE name = ?
`);

const checkProfileNameExistsExcludingStmt = db.prepare<{ count: number }, [string, number]>(`
  SELECT COUNT(*) as count FROM voice_profiles WHERE name = ? AND id != ?
`);

const updateProfileNameStmt = db.prepare<ProfileRow, [string, number]>(`
  UPDATE voice_profiles SET name = ? WHERE id = ? RETURNING id, name, created_at, notes
`);

interface ProfileSampleRow {
  id: number;
  clip_path: string;
  speaker_label: string;
  folder_name: string;
  meeting_date: string | null;
  source: string;
}

const getProfileSamplesStmt = db.prepare<ProfileSampleRow, [number, number]>(`
  SELECT us.id, us.clip_path, us.speaker_label, m.folder_name, m.meeting_date, 'unknown' as source
  FROM unknown_speakers us
  JOIN meetings m ON us.meeting_id = m.id
  WHERE us.assigned_profile_id = ? AND us.clip_path IS NOT NULL AND us.status = 'assigned'

  UNION ALL

  SELECT mp.id, mp.clip_path, mp.speaker_label, m.folder_name, m.meeting_date, 'identified' as source
  FROM meeting_participants mp
  JOIN meetings m ON mp.meeting_id = m.id
  WHERE mp.profile_id = ? AND mp.is_identified = 1 AND mp.clip_path IS NOT NULL

  ORDER BY meeting_date DESC
`);

interface MeetingParticipantForDeleteRow {
  meeting_id: number;
  speaker_label: string;
  transcript_path: string | null;
}

const getProfileParticipantsStmt = db.prepare<MeetingParticipantForDeleteRow, [number]>(`
  SELECT mp.meeting_id, mp.speaker_label, m.transcript_path
  FROM meeting_participants mp
  JOIN meetings m ON mp.meeting_id = m.id
  WHERE mp.profile_id = ?
`);

const clearParticipantProfileStmt = db.prepare(`
  UPDATE meeting_participants SET profile_id = NULL, is_identified = 0 WHERE profile_id = ?
`);

const resetUnknownSpeakersStmt = db.prepare(`
  UPDATE unknown_speakers SET assigned_profile_id = NULL, status = 'pending' WHERE assigned_profile_id = ?
`);

const deleteProfileStmt = db.prepare(`DELETE FROM voice_profiles WHERE id = ?`);

interface SampleForReassignRow {
  id: number;
  meeting_id: number;
  speaker_label: string;
  assigned_profile_id: number | null;
}

const getSampleStmt = db.prepare<SampleForReassignRow, [number]>(`
  SELECT id, meeting_id, speaker_label, assigned_profile_id FROM unknown_speakers WHERE id = ?
`);

interface ParticipantForReassignRow {
  id: number;
  meeting_id: number;
  speaker_label: string;
  profile_id: number | null;
}

const getParticipantStmt = db.prepare<ParticipantForReassignRow, [number]>(`
  SELECT id, meeting_id, speaker_label, profile_id FROM meeting_participants WHERE id = ?
`);

const updateParticipantProfileStmt = db.prepare(`
  UPDATE meeting_participants SET profile_id = ? WHERE id = ?
`);

const getMeetingTranscriptStmt = db.prepare<{ transcript_path: string | null }, [number]>(`
  SELECT transcript_path FROM meetings WHERE id = ?
`);

const reassignEmbeddingStmt = db.prepare(`
  UPDATE voice_embeddings SET profile_id = ? WHERE profile_id = ? AND source_meeting_id = ?
`);

const reassignParticipantStmt = db.prepare(`
  UPDATE meeting_participants SET profile_id = ?, is_identified = 1
  WHERE meeting_id = ? AND speaker_label = ?
`);

const reassignUnknownSpeakerStmt = db.prepare(`
  UPDATE unknown_speakers SET assigned_profile_id = ? WHERE id = ?
`);

/**
 * GET /api/profiles
 * List all profiles with embedding and meeting counts
 */
export const handleGetProfiles = (req: Request): Response => {
  try {
    const profiles = listProfilesStmt.all();

    return Response.json({
      success: true,
      data: profiles.map((p) => {
        const count = p.embedding_count;
        const avgQuality = p.avg_quality ?? 0;
        const confidence = count === 0
          ? 0
          : Math.min(99, Math.round(100 * (1 - Math.exp(-0.3 * count)) * (0.5 + 0.5 * avgQuality)));
        return {
          id: p.id,
          name: p.name,
          createdAt: p.created_at,
          notes: p.notes,
          embeddingCount: count,
          sampleCount: p.sample_count,
          meetingCount: p.meeting_count,
          confidence,
        };
      }),
      count: profiles.length,
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
 * POST /api/profiles
 * Create a new empty profile
 * Body: { name: string, notes?: string }
 */
export const handleCreateProfile = async (req: Request): Promise<Response> => {
  try {
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

    const notes = body.notes?.trim() || null;
    const profile = insertProfileStmt.get(name, notes);

    if (!profile) {
      return Response.json(
        { success: false, error: "Failed to create profile" },
        { status: 500 }
      );
    }

    return Response.json(
      {
        success: true,
        data: {
          id: profile.id,
          name: profile.name,
          createdAt: profile.created_at,
          notes: profile.notes,
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
 * GET /api/profiles/:id/samples
 * Get voice sample clips for a profile
 */
export const handleGetProfileSamples = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/profiles\/(\d+)\/samples$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid profile ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const samples = getProfileSamplesStmt.all(id, id);

    return Response.json({
      success: true,
      data: samples.map((s) => ({
        id: s.id,
        clipPath: s.clip_path,
        speakerLabel: s.speaker_label,
        folderName: s.folder_name,
        meetingDate: s.meeting_date,
        source: s.source,
      })),
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
 * DELETE /api/profiles/:id
 * Delete a profile, reverting transcripts and freeing unknown speakers for reassignment
 */
export const handleDeleteProfile = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/profiles\/(\d+)$/);
    if (!idMatch) {
      return Response.json({ success: false, error: "Invalid profile ID" }, { status: 400 });
    }

    const id = parseInt(idMatch[1], 10);
    const profile = getProfileStmt.get(id);
    if (!profile) {
      return Response.json({ success: false, error: "Profile not found" }, { status: 404 });
    }

    // Collect transcript rewrites before modifying DB
    const participants = getProfileParticipantsStmt.all(id);

    // Revert transcripts: replace profile.name → speaker_label
    for (const p of participants) {
      if (p.transcript_path) {
        try {
          await rewriteTranscriptArtifacts(
            p.transcript_path,
            p.speaker_label,
            profile.name,
            p.speaker_label,
          );
        } catch {
          // non-fatal: transcript may not exist
        }
      }
    }

    db.transaction(() => {
      clearParticipantProfileStmt.run(id);
      resetUnknownSpeakersStmt.run(id);
      deleteProfileStmt.run(id); // voice_embeddings cascade
    })();

    return Response.json({ success: true, data: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * PATCH /api/profiles/:id
 * Rename a profile and rewrite all associated transcripts
 * Body: { name: string }
 */
export const handleUpdateProfile = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/profiles\/(\d+)$/);
    if (!idMatch) {
      return Response.json({ success: false, error: "Invalid profile ID" }, { status: 400 });
    }

    const id = parseInt(idMatch[1], 10);
    const body = await req.json();

    if (!body.name || typeof body.name !== "string") {
      return Response.json({ success: false, error: "Name is required" }, { status: 400 });
    }

    const name = body.name.trim();
    if (name.length === 0) {
      return Response.json({ success: false, error: "Name cannot be empty" }, { status: 400 });
    }

    const profile = getProfileStmt.get(id);
    if (!profile) {
      return Response.json({ success: false, error: "Profile not found" }, { status: 404 });
    }

    if (profile.name === name) {
      return Response.json({
        success: true,
        data: { id: profile.id, name: profile.name, createdAt: profile.created_at, notes: profile.notes },
      });
    }

    const existing = checkProfileNameExistsExcludingStmt.get(name, id);
    if (existing && existing.count > 0) {
      return Response.json(
        { success: false, error: "A profile with this name already exists" },
        { status: 409 }
      );
    }

    const oldName = profile.name;
    const updated = updateProfileNameStmt.get(name, id);
    if (!updated) {
      return Response.json({ success: false, error: "Failed to update profile" }, { status: 500 });
    }

    // Rewrite transcripts: replace oldName → newName for all meetings this profile appears in
    const participants = getProfileParticipantsStmt.all(id);
    for (const p of participants) {
      if (p.transcript_path) {
        try {
          await rewriteTranscriptArtifacts(p.transcript_path, p.speaker_label, oldName, name);
        } catch {
          // non-fatal
        }
      }
    }

    return Response.json({
      success: true,
      data: { id: updated.id, name: updated.name, createdAt: updated.created_at, notes: updated.notes },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/profiles/samples/:sampleId/reassign
 * Reassign a voice sample from one profile to another
 * Body: { profileId: number, source: 'unknown' | 'identified' }
 */
export const handleReassignSample = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/profiles\/samples\/(\d+)\/reassign$/);
    if (!idMatch) {
      return Response.json({ success: false, error: "Invalid sample ID" }, { status: 400 });
    }

    const sampleId = parseInt(idMatch[1], 10);
    const body = await req.json();

    if (!body.profileId || typeof body.profileId !== "number") {
      return Response.json({ success: false, error: "profileId is required" }, { status: 400 });
    }

    const source = body.source === "identified" ? "identified" : "unknown";

    if (source === "identified") {
      // Reassign a meeting_participants row
      const participant = getParticipantStmt.get(sampleId);
      if (!participant) {
        return Response.json({ success: false, error: "Sample not found" }, { status: 404 });
      }
      if (!participant.profile_id) {
        return Response.json({ success: false, error: "Sample is not assigned to any profile" }, { status: 400 });
      }

      const oldProfile = getProfileStmt.get(participant.profile_id);
      const newProfile = getProfileStmt.get(body.profileId);

      if (!oldProfile) {
        return Response.json({ success: false, error: "Current profile not found" }, { status: 404 });
      }
      if (!newProfile) {
        return Response.json({ success: false, error: "Target profile not found" }, { status: 404 });
      }
      if (oldProfile.id === newProfile.id) {
        return Response.json({ success: false, error: "Already assigned to this profile" }, { status: 400 });
      }

      const meeting = getMeetingTranscriptStmt.get(participant.meeting_id);

      db.transaction(() => {
        updateParticipantProfileStmt.run(newProfile.id, sampleId);
        reassignEmbeddingStmt.run(newProfile.id, oldProfile.id, participant.meeting_id);
      })();

      if (meeting?.transcript_path) {
        try {
          await rewriteTranscriptArtifacts(
            meeting.transcript_path,
            participant.speaker_label,
            oldProfile.name,
            newProfile.name,
          );
        } catch {
          // non-fatal
        }
      }

      return Response.json({
        success: true,
        data: { sampleId, fromProfile: oldProfile.name, toProfile: newProfile.name },
      });
    }

    // source === 'unknown': original logic
    const sample = getSampleStmt.get(sampleId);
    if (!sample) {
      return Response.json({ success: false, error: "Sample not found" }, { status: 404 });
    }
    if (!sample.assigned_profile_id) {
      return Response.json({ success: false, error: "Sample is not assigned to any profile" }, { status: 400 });
    }

    const oldProfile = getProfileStmt.get(sample.assigned_profile_id);
    const newProfile = getProfileStmt.get(body.profileId);

    if (!oldProfile) {
      return Response.json({ success: false, error: "Current profile not found" }, { status: 404 });
    }
    if (!newProfile) {
      return Response.json({ success: false, error: "Target profile not found" }, { status: 404 });
    }
    if (oldProfile.id === newProfile.id) {
      return Response.json({ success: false, error: "Already assigned to this profile" }, { status: 400 });
    }

    const meeting = getMeetingTranscriptStmt.get(sample.meeting_id);

    db.transaction(() => {
      reassignEmbeddingStmt.run(newProfile.id, oldProfile.id, sample.meeting_id);
      reassignParticipantStmt.run(newProfile.id, sample.meeting_id, sample.speaker_label);
      reassignUnknownSpeakerStmt.run(newProfile.id, sampleId);
    })();

    if (meeting?.transcript_path) {
      try {
        await rewriteTranscriptArtifacts(
          meeting.transcript_path,
          sample.speaker_label,
          oldProfile.name,
          newProfile.name,
        );
      } catch {
        // non-fatal
      }
    }

    return Response.json({
      success: true,
      data: { sampleId, fromProfile: oldProfile.name, toProfile: newProfile.name },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * GET /api/profiles/:id
 * Get profile detail with meetings they appear in
 */
export const handleGetProfile = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/profiles\/(\d+)$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid profile ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const profile = getProfileStmt.get(id);

    if (!profile) {
      return Response.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    const meetings = getProfileMeetingsStmt.all(id);

    return Response.json({
      success: true,
      data: {
        id: profile.id,
        name: profile.name,
        createdAt: profile.created_at,
        notes: profile.notes,
        meetings: meetings.map((m) => ({
          meetingId: m.meeting_id,
          folderName: m.folder_name,
          meetingDate: m.meeting_date,
          speakerLabel: m.speaker_label,
        })),
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
