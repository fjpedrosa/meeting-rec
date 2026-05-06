import { db } from "../db";
import { join } from "path";
import { $ } from "bun";
import { startTracking, pushEvent } from "./process-events";

const PROJECT_DIR = join(import.meta.dir, "..", "..");
const VENV_DIR = join(PROJECT_DIR, "pipeline", ".venv");
const PIPELINE_SCRIPT = join(PROJECT_DIR, "pipeline", "process_meeting.py");
const DB_PATH = join(PROJECT_DIR, "data", "db", "meetings.db");
const COMMAND_OUTPUT_MAX_LINES = 25;

const formatCommandOutput = (output: string): string => {
  const trimmed = output.trim();
  if (!trimmed) return "(no output)";

  return trimmed.split(/\r?\n/).slice(-COMMAND_OUTPUT_MAX_LINES).join("\n");
};

/**
 * GET /api/process/pick-file
 * Opens a native macOS file picker for .mov files and returns the selected path
 */
export const handlePickFile = async (req: Request): Promise<Response> => {
  try {
    const result = await $`osascript -e 'POSIX path of (choose file of type {"public.movie"} with prompt "Select a meeting recording")'`.quiet();
    const filePath = result.text().trim();

    if (!filePath) {
      return Response.json(
        { success: false, error: "No file selected" },
        { status: 400 }
      );
    }

    return Response.json({
      success: true,
      data: { path: filePath },
    });
  } catch (error) {
    // User cancelled the dialog
    return Response.json(
      { success: false, error: "File selection cancelled" },
      { status: 400 }
    );
  }
};

/**
 * POST /api/process
 * Process a .mov file: extract audio → transcribe → diarize
 * Body: { movPath: string, language?: "es" | "en" }
 */
export const handleProcessMov = async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();

    if (!body.movPath || typeof body.movPath !== "string") {
      return Response.json(
        { success: false, error: "movPath is required" },
        { status: 400 }
      );
    }

    const movPath = body.movPath;
    const language = body.language || undefined;

    // Check file exists
    const movFile = Bun.file(movPath);
    if (!(await movFile.exists())) {
      return Response.json(
        { success: false, error: `File not found: ${movPath}` },
        { status: 404 }
      );
    }

    if (movFile.size === 0) {
      return Response.json(
        { success: false, error: `Recording file is empty: ${movPath}` },
        { status: 400 }
      );
    }

    // Derive MP3 path (same directory, same name, .mp3 extension)
    const mp3Path = movPath.replace(/\.[^.]+$/, ".mp3");

    // Extract audio with ffmpeg
    console.log(`Extracting audio from ${movPath}...`);
    const ffmpegResult = await $`ffmpeg -y -i ${movPath} -vn -acodec libmp3lame -q:a 2 ${mp3Path} 2>&1`.nothrow().quiet();

    if (ffmpegResult.exitCode !== 0) {
      return Response.json(
        {
          success: false,
          error: `ffmpeg failed with exit code ${ffmpegResult.exitCode}:\n${formatCommandOutput(ffmpegResult.text())}`,
        },
        { status: 500 }
      );
    }

    console.log(`Audio extracted to ${mp3Path}`);

    // Get certifi path for SSL
    const certifiResult = await $`${VENV_DIR}/bin/python -c "import certifi; print(certifi.where())"`.nothrow().quiet();
    if (certifiResult.exitCode !== 0) {
      return Response.json(
        {
          success: false,
          error: `Python certifi lookup failed with exit code ${certifiResult.exitCode}:\n${formatCommandOutput(certifiResult.text())}`,
        },
        { status: 500 }
      );
    }

    const certPath = certifiResult.text().trim();
    if (!certPath) {
      return Response.json(
        {
          success: false,
          error: "Python certifi lookup returned an empty certificate path",
        },
        { status: 500 }
      );
    }

    // Launch pipeline in background
    const env = {
      ...process.env,
      HF_TOKEN: process.env.HF_TOKEN || Bun.env.HF_TOKEN || "",
      SSL_CERT_FILE: certPath,
      REQUESTS_CA_BUNDLE: certPath,
      PATH: process.env.PATH,
    };

    const langArgs = language ? ["--language", language] : [];

    console.log(`Starting pipeline for ${mp3Path}...`);

    // Query meetingId — the pipeline inserts the meeting row, but we need to find it
    // after the pipeline starts. We'll poll for it.
    let meetingId = 0;

    // Run pipeline async with piped stdout for progress events
    const pipelineProc = Bun.spawn(
      [join(VENV_DIR, "bin", "python"), "-u", PIPELINE_SCRIPT, mp3Path, "--db", DB_PATH, ...langArgs],
      { env, stdout: "pipe", stderr: "pipe" }
    );

    // Read stdout line by line and push SSE events
    const readStdout = async () => {
      if (!pipelineProc.stdout) return;
      const reader = pipelineProc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);

            // Try to get meetingId if we don't have it yet
            if (meetingId === 0) {
              const row = db.query("SELECT id FROM meetings WHERE mp3_path = ? ORDER BY id DESC LIMIT 1").get(mp3Path) as { id: number } | null;
              if (row) {
                meetingId = row.id;
                startTracking(meetingId);
              }
            }

            if (meetingId > 0) {
              pushEvent(meetingId, parsed);
            }
          } catch {
            // Not JSON — treat as log
            if (meetingId > 0) {
              pushEvent(meetingId, { type: 'log', message: trimmed });
            }
          }
        }
      }
    };

    readStdout();

    pipelineProc.exited.then(async (code) => {
      if (code === 0) {
        console.log(`Pipeline completed for ${mp3Path}`);
      } else {
        const stderr = pipelineProc.stderr
          ? await new Response(pipelineProc.stderr).text()
          : "";
        console.error(`Pipeline failed for ${mp3Path} with exit code ${code}`);
        if (stderr) console.error(`Pipeline stderr:\n${stderr}`);
        if (meetingId > 0) {
          pushEvent(meetingId, { type: 'error', message: `Pipeline exited with code ${code}` });
        }
      }
    });

    return Response.json({
      success: true,
      data: {
        movPath,
        mp3Path,
        language: language || "auto",
        status: "processing",
        message: "Audio extracted and pipeline started. Check the meetings list for progress.",
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
