import { db } from "../db";
import { join } from "path";
import { getStructuredTranscriptPath } from "../transcript";

const PROJECT_DIR = join(import.meta.dir, "..", "..");
const VENV_DIR = join(PROJECT_DIR, "pipeline", ".venv");
const PIPELINE_SCRIPT = join(PROJECT_DIR, "pipeline", "process_meeting.py");
const DB_PATH = join(PROJECT_DIR, "data", "db", "meetings.db");

// Types for database rows
interface MeetingRow {
  id: number;
  folder_name: string;
  mp3_path: string | null;
  transcript_path: string | null;
  language: string | null;
  meeting_date: string | null;
  processed_at: string | null;
  duration_seconds: number | null;
  status: string;
  error_message: string | null;
  title: string | null;
}

interface ParticipantRow {
  id: number;
  meeting_id: number;
  profile_id: number | null;
  speaker_label: string;
  is_identified: number;
  profile_name: string | null;
  clip_path: string | null;
}

// Tag type for meeting responses
interface MeetingTagRow {
  id: number;
  name: string;
  color: string;
}

const getMeetingTagsStmt = db.prepare<MeetingTagRow, [number]>(`
  SELECT t.id, t.name, t.color
  FROM tags t
  JOIN meeting_tags mt ON t.id = mt.tag_id
  WHERE mt.meeting_id = ?
  ORDER BY t.name
`);

// Prepared statements for better performance
const listMeetingsStmt = db.prepare<MeetingRow, []>(`
  SELECT id, folder_name, mp3_path, transcript_path, language,
         meeting_date, processed_at, duration_seconds, status, error_message, title
  FROM meetings
  WHERE status != 'archived'
  ORDER BY meeting_date DESC
`);

const listMeetingsByStatusStmt = db.prepare<MeetingRow, [string]>(`
  SELECT id, folder_name, mp3_path, transcript_path, language,
         meeting_date, processed_at, duration_seconds, status, error_message, title
  FROM meetings
  WHERE status = ? AND status != 'archived'
  ORDER BY meeting_date DESC
`);

const getMeetingStmt = db.prepare<MeetingRow, [number]>(`
  SELECT id, folder_name, mp3_path, transcript_path, language,
         meeting_date, processed_at, duration_seconds, status, error_message, title
  FROM meetings
  WHERE id = ?
`);

const getMeetingParticipantsStmt = db.prepare<ParticipantRow, [number]>(`
  SELECT mp.id, mp.meeting_id, mp.profile_id, mp.speaker_label, mp.is_identified,
         mp.clip_path, vp.name as profile_name
  FROM meeting_participants mp
  LEFT JOIN voice_profiles vp ON mp.profile_id = vp.id
  WHERE mp.meeting_id = ?
  ORDER BY mp.speaker_label
`);

/**
 * GET /api/meetings
 * List all meetings ordered by meeting_date DESC
 * Optional query params:
 *   ?status=pending|completed|error
 *   ?profile_id=X  — filter by participant profile
 *   ?tag_id=X      — filter by tag
 */
export const handleGetMeetings = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const profileId = url.searchParams.get("profile_id");
    const tagId = url.searchParams.get("tag_id");

    // Build dynamic query when filters are present
    let meetings: MeetingRow[];

    if (profileId || tagId) {
      const conditions: string[] = ["m.status != 'archived'"];
      const joins: string[] = [];
      const params: (string | number)[] = [];

      if (status) {
        conditions.push("m.status = ?");
        params.push(status);
      }

      if (profileId) {
        joins.push("JOIN meeting_participants mp_filter ON m.id = mp_filter.meeting_id");
        conditions.push("mp_filter.profile_id = ?");
        params.push(parseInt(profileId, 10));
      }

      if (tagId) {
        joins.push("JOIN meeting_tags mt_filter ON m.id = mt_filter.meeting_id");
        conditions.push("mt_filter.tag_id = ?");
        params.push(parseInt(tagId, 10));
      }

      const sql = `
        SELECT DISTINCT m.id, m.folder_name, m.mp3_path, m.transcript_path, m.language,
               m.meeting_date, m.processed_at, m.duration_seconds, m.status, m.error_message, m.title
        FROM meetings m
        ${joins.join("\n")}
        WHERE ${conditions.join(" AND ")}
        ORDER BY m.meeting_date DESC
      `;

      meetings = db.prepare<MeetingRow, (string | number)[]>(sql).all(...params);
    } else {
      meetings = status
        ? listMeetingsByStatusStmt.all(status)
        : listMeetingsStmt.all();
    }

    // Attach tags to each meeting
    const data = meetings.map((m) => ({
      ...m,
      tags: getMeetingTagsStmt.all(m.id),
    }));

    return Response.json({
      success: true,
      data,
      count: data.length,
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
 * GET /api/meetings/:id
 * Get single meeting with its participants
 */
export const handleGetMeeting = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    const participants = getMeetingParticipantsStmt.all(id);

    const tags = getMeetingTagsStmt.all(id);

    return Response.json({
      success: true,
      data: {
        ...meeting,
        tags,
        participants: participants.map((p) => ({
          id: p.id,
          speakerLabel: p.speaker_label,
          profileId: p.profile_id,
          profileName: p.profile_name,
          isIdentified: Boolean(p.is_identified),
          clipPath: p.clip_path,
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

/**
 * GET /api/meetings/:id/transcription
 * Read and return the transcript file content
 */
/**
 * PATCH /api/meetings/:id
 * Update meeting metadata (title, etc.)
 * Body: { title?: string }
 */
export const handleUpdateMeeting = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const body = await req.json();

    if (body.title !== undefined) {
      db.prepare("UPDATE meetings SET title = ? WHERE id = ?").run(body.title, id);
    }

    const meeting = getMeetingStmt.get(id);
    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    return Response.json({ success: true, data: meeting });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};

/**
 * GET /api/meetings/:id/transcription
 */
export const handleGetTranscription = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)\/transcription$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    if (!meeting.transcript_path) {
      return Response.json(
        { success: false, error: "Transcript not available" },
        { status: 404 }
      );
    }

    const file = Bun.file(meeting.transcript_path);

    if (!(await file.exists())) {
      return Response.json(
        { success: false, error: "Transcript file not found on disk" },
        { status: 404 }
      );
    }

    const content = await file.text();

    return Response.json({
      success: true,
      data: {
        meetingId: id,
        path: meeting.transcript_path,
        content,
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
 * GET /api/meetings/:id/transcription-structured
 */
export const handleGetStructuredTranscription = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)\/transcription-structured$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    if (!meeting.transcript_path) {
      return Response.json(
        { success: false, error: "Structured transcript not available" },
        { status: 404 }
      );
    }

    const structuredPath = getStructuredTranscriptPath(meeting.transcript_path);
    const file = Bun.file(structuredPath);

    if (!(await file.exists())) {
      return Response.json(
        { success: false, error: "Structured transcript file not found on disk" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      data: {
        meetingId: id,
        path: structuredPath,
        content: await file.json(),
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
 * GET /api/meetings/:id/transcription/download
 * Download the transcript as a .txt file
 */
export const handleDownloadTranscription = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)\/transcription\/download$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    if (!meeting.transcript_path) {
      return Response.json(
        { success: false, error: "Transcript not available" },
        { status: 404 }
      );
    }

    const file = Bun.file(meeting.transcript_path);

    if (!(await file.exists())) {
      return Response.json(
        { success: false, error: "Transcript file not found on disk" },
        { status: 404 }
      );
    }

    const filename = `${meeting.title || meeting.folder_name}.txt`;

    return new Response(file, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
 * DELETE /api/meetings/:id
 * Soft-delete: sets status to 'archived'
 */
export const handleArchiveMeeting = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    db.prepare("UPDATE meetings SET status = 'archived' WHERE id = ?").run(id);

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};

/**
 * POST /api/meetings/:id/rediarize
 * Re-run the full pipeline for a completed meeting (re-transcribe + re-diarize)
 */
export const handleRediarize = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)\/rediarize$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    if (meeting.status !== "completed") {
      return Response.json(
        { success: false, error: "Only completed meetings can be re-diarized" },
        { status: 400 }
      );
    }

    if (!meeting.mp3_path) {
      return Response.json(
        { success: false, error: "No audio file available" },
        { status: 400 }
      );
    }

    // Clean up old data: detach embeddings (keep them for profiles), delete participants/unknowns
    db.prepare("UPDATE voice_embeddings SET source_meeting_id = NULL WHERE source_meeting_id = ?").run(id);
    db.prepare("DELETE FROM meeting_participants WHERE meeting_id = ?").run(id);
    db.prepare("DELETE FROM unknown_speakers WHERE meeting_id = ?").run(id);

    const mp3Path = meeting.mp3_path!;
    const language = meeting.language;
    const title = meeting.title;

    // Delete old meeting row and let the pipeline create a fresh one
    db.prepare("DELETE FROM meetings WHERE id = ?").run(id);

    // Get certifi path for SSL
    const { $ } = await import("bun");
    const certifiResult = await $`${VENV_DIR}/bin/python -c "import certifi; print(certifi.where())"`.quiet();
    const certPath = certifiResult.text().trim();

    const env = {
      ...process.env,
      HF_TOKEN: process.env.HF_TOKEN || Bun.env.HF_TOKEN || "",
      SSL_CERT_FILE: certPath,
      REQUESTS_CA_BUNDLE: certPath,
      PATH: process.env.PATH,
    };

    const langArgs = language && language !== "auto" ? ["--language", language] : [];

    console.log(`Re-diarizing meeting ${id}: ${mp3Path}...`);

    const pipelineProc = Bun.spawn(
      [join(VENV_DIR, "bin", "python"), PIPELINE_SCRIPT, mp3Path, "--db", DB_PATH, ...langArgs],
      { env, stdout: "inherit", stderr: "pipe" }
    );

    pipelineProc.exited.then(async (code) => {
      if (code === 0) {
        // Restore title if it had one
        if (title) {
          const newMeeting = db.prepare<MeetingRow, [string]>(
            "SELECT id FROM meetings WHERE mp3_path = ? ORDER BY id DESC LIMIT 1"
          ).get(mp3Path);
          if (newMeeting) {
            db.prepare("UPDATE meetings SET title = ? WHERE id = ?").run(title, newMeeting.id);
          }
        }
        console.log(`Re-diarize completed for meeting ${id}`);
      } else {
        const stderr = pipelineProc.stderr
          ? await new Response(pipelineProc.stderr).text()
          : "";
        console.error(`Re-diarize failed for meeting ${id} with exit code ${code}`);
        if (stderr) {
          console.error(`Pipeline stderr:\n${stderr}`);
        }
      }
    });

    return Response.json({
      success: true,
      data: { status: "processing", message: "Re-diarization started" },
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
 * POST /api/meetings/:id/retry
 * Re-run the pipeline for a failed meeting
 */
export const handleRetryMeeting = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)\/retry$/);

    if (!idMatch) {
      return Response.json(
        { success: false, error: "Invalid meeting ID" },
        { status: 400 }
      );
    }

    const id = parseInt(idMatch[1], 10);
    const meeting = getMeetingStmt.get(id);

    if (!meeting) {
      return Response.json(
        { success: false, error: "Meeting not found" },
        { status: 404 }
      );
    }

    if (meeting.status !== "error") {
      return Response.json(
        { success: false, error: "Only failed meetings can be retried" },
        { status: 400 }
      );
    }

    // Delete the old meeting row — the pipeline will create a new one
    db.prepare("DELETE FROM meeting_participants WHERE meeting_id = ?").run(id);
    db.prepare("DELETE FROM unknown_speakers WHERE meeting_id = ?").run(id);
    db.prepare("DELETE FROM meetings WHERE id = ?").run(id);

    const mp3Path = meeting.mp3_path!;
    const language = meeting.language;

    // Get certifi path for SSL
    const { $ } = await import("bun");
    const certifiResult = await $`${VENV_DIR}/bin/python -c "import certifi; print(certifi.where())"`.quiet();
    const certPath = certifiResult.text().trim();

    const env = {
      ...process.env,
      HF_TOKEN: process.env.HF_TOKEN || Bun.env.HF_TOKEN || "",
      SSL_CERT_FILE: certPath,
      REQUESTS_CA_BUNDLE: certPath,
      PATH: process.env.PATH,
    };

    const langArgs = language && language !== "auto" ? ["--language", language] : [];

    console.log(`Retrying pipeline for ${mp3Path}...`);

    const pipelineProc = Bun.spawn(
      [join(VENV_DIR, "bin", "python"), PIPELINE_SCRIPT, mp3Path, "--db", DB_PATH, ...langArgs],
      { env, stdout: "inherit", stderr: "pipe" }
    );

    pipelineProc.exited.then(async (code) => {
      if (code === 0) {
        console.log(`Retry pipeline completed for ${mp3Path}`);
      } else {
        const stderr = pipelineProc.stderr
          ? await new Response(pipelineProc.stderr).text()
          : "";
        console.error(`Retry pipeline failed for ${mp3Path} with exit code ${code}`);
        if (stderr) {
          console.error(`Pipeline stderr:\n${stderr}`);
        }
      }
    });

    return Response.json({
      success: true,
      data: { status: "processing", message: "Pipeline restarted" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
};
