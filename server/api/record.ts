import { extname, join, basename } from "path";
import { mkdir, stat, unlink } from "node:fs/promises";
import type { Subprocess } from "bun";

// Directory for recordings
const RECORDINGS_DIR = join(import.meta.dir, "..", "..", "data", "recordings");

// Module-level state for recording
// stdout: "ignore" — nobody reads it, avoid unnecessary pipe
// stderr: "pipe" — drained continuously to prevent buffer deadlock
let ffmpegProcess: Subprocess<"pipe", "ignore", "pipe"> | null = null;
let currentRecordingPath: string | null = null;
let currentRecordingTempPath: string | null = null;
let recordingStartedAt: string | null = null;
let ffmpegProgress: { time: string; size: string; speed: string } | null = null;
let ffmpegStderrTail = "";

// === Capture state (persistent preview, separate from recording) ===
type CaptureProcess = Subprocess<"pipe", "pipe", "pipe">;

let captureProcess: CaptureProcess | null = null;
let captureScreenIndex: number | null = null;
let captureLatestFrame: Uint8Array | null = null;
let captureStartedAt: string | null = null;
let captureFrameTimestamps: number[] = [];
let nextCaptureStreamClientId = 1;

const captureStreamClients = new Map<
  number,
  ReadableStreamDefaultController<Uint8Array>
>();

const STOP_TIMEOUT_MS = 3000;
const CAPTURE_STOP_TIMEOUT_MS = 1500;
const CAPTURE_TARGET_FPS = 30;
const CAPTURE_FPS_WINDOW_MS = 2000;
const CAPTURE_STREAM_BOUNDARY = "frame";
const CAPTURE_STREAM_HEADERS = {
  "Content-Type": `multipart/x-mixed-replace; boundary=${CAPTURE_STREAM_BOUNDARY}`,
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Connection": "keep-alive",
} as const;
const encoder = new TextEncoder();

// Ensure recordings directory exists
const ensureRecordingsDir = async (): Promise<void> => {
  await mkdir(RECORDINGS_DIR, { recursive: true });
};

const resetRecordingState = (): void => {
  ffmpegProcess = null;
  currentRecordingPath = null;
  currentRecordingTempPath = null;
  recordingStartedAt = null;
  ffmpegProgress = null;
  ffmpegStderrTail = "";
};

const waitForProcessExit = async (
  process: { exitCode: number | null; exited: Promise<number> },
  timeoutMs: number
): Promise<boolean> => {
  if (process.exitCode !== null) {
    return true;
  }

  return Promise.race([
    process.exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
};

/**
 * Continuously drains ffmpeg's stderr to prevent pipe buffer deadlock.
 * ffmpeg writes ~30 progress lines/second to stderr. Without draining,
 * the OS pipe buffer (~64KB) fills and ffmpeg blocks, producing 0-byte output.
 * Also parses progress info for the status endpoint.
 */
const drainStderr = async (proc: Subprocess<"pipe", "ignore", "pipe">): Promise<void> => {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // ffmpeg progress lines end with \r (carriage return), not \n
      const lines = buffer.split(/[\r\n]/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        ffmpegStderrTail = `${ffmpegStderrTail}\n${trimmed}`.trim().split("\n").slice(-25).join("\n");
        // Parse progress: "frame= 150 fps= 30 size= 1024kB time=00:00:05.00 bitrate=... speed=1.0x"
        const timeMatch = trimmed.match(/time=(\S+)/);
        const sizeMatch = trimmed.match(/size=\s*(\S+)/);
        const speedMatch = trimmed.match(/speed=(\S+)/);
        if (timeMatch) {
          ffmpegProgress = {
            time: timeMatch[1],
            size: sizeMatch?.[1] || "0kB",
            speed: speedMatch?.[1] || "0x",
          };
        }
      }
    }
  } catch {
    // Process was killed or pipe closed — expected during stop
  }
};

// Parse ffmpeg device list output
const parseDevices = (
  stderr: string
): { video: { index: number; name: string }[]; audio: { index: number; name: string }[] } => {
  const video: { index: number; name: string }[] = [];
  const audio: { index: number; name: string }[] = [];

  const lines = stderr.split("\n");
  let currentCategory: "video" | "audio" | null = null;

  for (const line of lines) {
    if (line.includes("AVFoundation video devices:")) {
      currentCategory = "video";
      continue;
    }
    if (line.includes("AVFoundation audio devices:")) {
      currentCategory = "audio";
      continue;
    }

    // Match device lines like "[0] FaceTime HD Camera" or "[7] Capture screen 0"
    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match && currentCategory) {
      const index = parseInt(match[1], 10);
      const name = match[2].trim();
      if (currentCategory === "video") {
        video.push({ index, name });
      } else {
        audio.push({ index, name });
      }
    }
  }

  return { video, audio };
};

const listAvfoundationDevices = async (): Promise<{
  video: { index: number; name: string }[];
  audio: { index: number; name: string }[];
}> => {
  const proc = Bun.spawn(
    ["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  return parseDevices(stderr);
};

const isScreenVideoDevice = (deviceName: string | undefined): boolean => {
  return (deviceName ?? "").toLowerCase().includes("capture screen");
};

const buildRecordingTempPath = (outputPath: string): string => {
  return outputPath.replace(/\.[^.]+$/, ".partial.mkv");
};

const sanitizeFilename = (name: string): string => {
  return basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
};

const extensionFromMimeType = (mimeType: string): string => {
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("quicktime")) return ".mov";
  return ".webm";
};

const resolveUploadedRecordingName = (file: File): string => {
  const originalName = sanitizeFilename(file.name || "recording");
  const originalExtension = extname(originalName);
  const baseName = originalExtension
    ? originalName.slice(0, -originalExtension.length)
    : originalName;
  const extension = originalExtension || extensionFromMimeType(file.type || "");

  return `${baseName || "recording"}_${Date.now()}${extension}`;
};

const buildRecordingCommand = (
  videoIndex: number,
  audioIndex: number | null,
  isScreenSource: boolean,
  tempOutputPath: string,
): string[] => {
  const commonInputArgs = [
    "ffmpeg",
    "-y",
    "-thread_queue_size", "512",
    "-f", "avfoundation",
  ];

  const screenInputArgs = [
    "-framerate", "30",
    "-capture_cursor", "1",
    "-probesize", "50M",
    "-i", `${videoIndex}:none`,
  ];

  const cameraInputArgs = [
    "-pixel_format", "nv12",
    "-video_size", "1280x720",
    "-framerate", "30",
    "-probesize", "20M",
    "-i", `${videoIndex}:none`,
  ];

  const audioInputArgs = audioIndex === null
    ? []
    : [
        "-thread_queue_size", "512",
        "-f", "avfoundation",
        "-i", `none:${audioIndex}`,
      ];

  const commonAudioArgs = [
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
  ];

  const screenVideoArgs = [
    "-c:v", "h264_videotoolbox",
    "-b:v", "8M",
    "-maxrate", "12M",
    "-bufsize", "16M",
    "-profile:v", "high",
    "-level", "4.2",
    "-realtime", "true",
    "-pix_fmt", "nv12",
  ];

  const cameraVideoArgs = [
    "-c:v", "h264_videotoolbox",
    "-b:v", "5M",
    "-maxrate", "8M",
    "-bufsize", "10M",
    "-pix_fmt", "nv12",
  ];

  const timingArgs = [
    "-vsync", "cfr",
    "-r", "30",
  ];

  const mapArgs = audioIndex === null
    ? ["-map", "0:v:0"]
    : ["-map", "0:v:0", "-map", "1:a:0?"];

  return [
    ...commonInputArgs,
    ...(isScreenSource ? screenInputArgs : cameraInputArgs),
    ...audioInputArgs,
    ...mapArgs,
    ...(isScreenSource ? screenVideoArgs : cameraVideoArgs),
    ...(audioIndex === null ? ["-an"] : commonAudioArgs),
    ...timingArgs,
    tempOutputPath,
  ];
};

const ensureFileExistsWithContent = async (filePath: string): Promise<number> => {
  const fileStat = await stat(filePath);
  if (fileStat.size <= 0) {
    throw new Error(`File exists but is empty: ${filePath}`);
  }
  return fileStat.size;
};

const finalizeRecording = async (
  tempPath: string,
  finalPath: string,
): Promise<void> => {
  await ensureFileExistsWithContent(tempPath);

  unlink(finalPath).catch(() => {});

  const remuxProc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i", tempPath,
      "-c", "copy",
      finalPath,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );

  const remuxStderr = await new Response(remuxProc.stderr).text();
  const remux = await remuxProc.exited;

  if (remux !== 0) {
    unlink(finalPath).catch(() => {});
    throw new Error(
      `Failed to remux recording into final file: ${finalPath}. ${remuxStderr.trim()}`,
    );
  }

  await ensureFileExistsWithContent(finalPath);

  unlink(tempPath).catch(() => {});
};

/**
 * GET /api/record/devices
 * Lists available avfoundation video and audio devices
 */
export const handleGetDevices = async (req: Request): Promise<Response> => {
  try {
    const devices = await listAvfoundationDevices();

    return Response.json({
      success: true,
      data: devices,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/record/upload
 * Persists a browser-recorded media file into the recordings directory.
 * Body: multipart/form-data with field "file"
 */
export const handleUploadRecording = async (req: Request): Promise<Response> => {
  try {
    await ensureRecordingsDir();

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { success: false, error: "file is required" },
        { status: 400 },
      );
    }

    const outputPath = join(RECORDINGS_DIR, resolveUploadedRecordingName(file));
    await Bun.write(outputPath, await file.arrayBuffer());

    return Response.json({
      success: true,
      data: { path: outputPath },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/record/start
 * Starts ffmpeg recording
 * Body: { screenIndex?: number, audioIndex?: number, filename?: string }
 */
export const handleStartRecording = async (req: Request): Promise<Response> => {
  try {
    if (ffmpegProcess !== null) {
      return Response.json(
        { success: false, error: "Recording already in progress" },
        { status: 409 }
      );
    }

    const body = await req.json();
    const screenIndex = body.screenIndex ?? 7; // Default: Capture screen 0
    const audioIndex = body.audioIndex ?? 0; // Default: MacBook mic
    const filename = body.filename || `recording_${Date.now()}.mov`;

    await ensureRecordingsDir();

    const devices = await listAvfoundationDevices();
    const selectedVideoDevice = devices.video.find((device) => device.index === screenIndex);
    const screenSource = isScreenVideoDevice(selectedVideoDevice?.name) || screenIndex >= 7;

    const outputPath = join(RECORDINGS_DIR, filename);
    const tempOutputPath = buildRecordingTempPath(outputPath);

    ffmpegProcess = Bun.spawn(
      buildRecordingCommand(screenIndex, audioIndex, screenSource, tempOutputPath),
      { stdin: "pipe", stdout: "ignore", stderr: "pipe" }
    );

    currentRecordingPath = outputPath;
    currentRecordingTempPath = tempOutputPath;
    recordingStartedAt = new Date().toISOString();

    // CRITICAL: drain stderr continuously to prevent pipe buffer deadlock.
    // ffmpeg writes progress to stderr at ~30 lines/sec; without draining,
    // the 64KB OS pipe buffer fills and ffmpeg stalls, producing 0-byte output.
    drainStderr(ffmpegProcess); // fire and forget

    // Log unexpected exits during recording
    ffmpegProcess.exited.then((code) => {
      if (code !== 0 && ffmpegProcess !== null) {
        console.error(`ffmpeg exited unexpectedly with code ${code} while recording`);
      }
    });

    // Give ffmpeg a moment to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check if process started successfully
    if (ffmpegProcess.exitCode !== null) {
      resetRecordingState();
      return Response.json(
        { success: false, error: `ffmpeg failed to start (exit code ${ffmpegProcess.exitCode}). Check Screen Recording permission in System Preferences > Privacy & Security.` },
        { status: 500 }
      );
    }

    console.log(
      `ffmpeg recording started: ${tempOutputPath} -> ${outputPath} ` +
      `(pid: ${ffmpegProcess.pid}, video: ${screenIndex}, audio: ${audioIndex}, source: ${screenSource ? "screen" : "camera"})`,
    );

    return Response.json({
      success: true,
      data: {
        path: outputPath,
        startedAt: recordingStartedAt,
      },
    });
  } catch (error) {
    resetRecordingState();
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/record/stop
 * Stops the current recording gracefully
 */
export const handleStopRecording = async (req: Request): Promise<Response> => {
  try {
    if (ffmpegProcess === null) {
      return Response.json(
        { success: false, error: "No recording in progress" },
        { status: 400 }
      );
    }

    const process = ffmpegProcess;
    const path = currentRecordingPath;
    const tempPath = currentRecordingTempPath;
    const startedAt = recordingStartedAt;

    if (!path || !tempPath) {
      resetRecordingState();
      return Response.json(
        { success: false, error: "Recording paths are missing; cannot finalize file" },
        { status: 500 },
      );
    }

    // If process already exited (e.g. crashed), just clean up
    if (process.exitCode !== null) {
      const stoppedAt = new Date().toISOString();
      const startTime = startedAt ? new Date(startedAt).getTime() : Date.now();
      const duration = Math.round((Date.now() - startTime) / 1000);

      try {
        await finalizeRecording(tempPath, path);
      } catch (error) {
        const stderrTail = ffmpegStderrTail || "(no stderr output)";
        resetRecordingState();
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json(
          {
            success: false,
            error: `${message}. Temporary file kept at ${tempPath}. ffmpeg tail:\n${stderrTail}`,
          },
          { status: 500 },
        );
      }

      resetRecordingState();
      return Response.json({
        success: true,
        data: { path, duration, stoppedAt },
      });
    }

    let exited = false;

    // Stage 0: Write 'q' to stdin — ffmpeg's preferred quit method.
    // Much more reliable than signals on macOS with avfoundation capture,
    // which often ignores SIGINT/SIGTERM while blocked in system calls.
    try {
      process.stdin.write("q\n");
      process.stdin.end();
      exited = await waitForProcessExit(process, 3000);
    } catch {
      // stdin might already be closed
    }

    // Stage 1: SIGINT — ffmpeg finalises the .mov container on SIGINT
    if (!exited && process.exitCode === null) {
      try {
        process.kill("SIGINT");
        exited = await waitForProcessExit(process, 3000);
      } catch {
        // process may already be dead
      }
    }

    // Stage 2: SIGTERM
    if (!exited && process.exitCode === null) {
      try {
        process.kill("SIGTERM");
        exited = await waitForProcessExit(process, STOP_TIMEOUT_MS);
      } catch {
        // ignore
      }
    }

    // Stage 3: SIGKILL — last resort, file won't be finalised
    if (!exited && process.exitCode === null) {
      try {
        process.kill("SIGKILL");
        await waitForProcessExit(process, 1000);
      } catch {
        // ignore
      }
      console.error("ffmpeg had to be force-killed (SIGKILL) — .mov may be corrupt");
    }

    // Calculate duration
    const stoppedAt = new Date().toISOString();
    const startTime = startedAt ? new Date(startedAt).getTime() : Date.now();
    const duration = Math.round((Date.now() - startTime) / 1000);

    try {
      await finalizeRecording(tempPath, path);
    } catch (error) {
      const stderrTail = ffmpegStderrTail || "(no stderr output)";
      resetRecordingState();
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        {
          success: false,
          error: `${message}. Temporary file kept at ${tempPath}. ffmpeg tail:\n${stderrTail}`,
        },
        { status: 500 },
      );
    }

    resetRecordingState();

    return Response.json({
      success: true,
      data: {
        path,
        duration,
        stoppedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * GET /api/record/status
 * Returns current recording status
 */
export const handleGetStatus = (req: Request): Response => {
  try {
    const recording = ffmpegProcess !== null;
    const elapsed = recordingStartedAt
      ? Math.round((Date.now() - new Date(recordingStartedAt).getTime()) / 1000)
      : undefined;

    return Response.json({
      success: true,
      data: {
        recording,
        ...(recording && {
          path: currentRecordingPath,
          startedAt: recordingStartedAt,
          elapsed,
          ffmpegProgress,
        }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/** Per-source temp path so concurrent requests never collide. */
const previewTmpPath = (key: string) => `/tmp/meeting_preview_${key}.jpg`;

/** JPEG response headers (allocated once). */
const PREVIEW_HEADERS = {
  "Content-Type": "image/jpeg",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
} as const;

const buildMultipartFrameChunk = (frame: Uint8Array): Uint8Array => {
  const header = encoder.encode(
    `--${CAPTURE_STREAM_BOUNDARY}\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `Content-Length: ${frame.length}\r\n\r\n`,
  );
  const footer = encoder.encode("\r\n");
  const chunk = new Uint8Array(header.length + frame.length + footer.length);
  chunk.set(header, 0);
  chunk.set(frame, header.length);
  chunk.set(footer, header.length + frame.length);
  return chunk;
};

const broadcastCaptureFrame = (frame: Uint8Array): void => {
  if (captureStreamClients.size === 0) {
    return;
  }

  const chunk = buildMultipartFrameChunk(frame);
  for (const [clientId, controller] of captureStreamClients) {
    try {
      controller.enqueue(chunk);
    } catch {
      captureStreamClients.delete(clientId);
    }
  }
};

const closeCaptureStreams = (): void => {
  for (const [clientId, controller] of captureStreamClients) {
    try {
      controller.close();
    } catch {
      // Stream already closed/cancelled
    }
    captureStreamClients.delete(clientId);
  }
};

const recordCaptureFrameTimestamp = (timestamp: number): void => {
  captureFrameTimestamps.push(timestamp);
  const cutoff = timestamp - CAPTURE_FPS_WINDOW_MS;
  while (captureFrameTimestamps.length > 0 && captureFrameTimestamps[0] < cutoff) {
    captureFrameTimestamps.shift();
  }
};

const getCaptureCurrentFps = (): number => {
  if (captureFrameTimestamps.length < 2) {
    return captureFrameTimestamps.length;
  }

  const first = captureFrameTimestamps[0];
  const last = captureFrameTimestamps[captureFrameTimestamps.length - 1];
  const elapsedMs = Math.max(last - first, 1);
  return Number(
    ((captureFrameTimestamps.length - 1) / (elapsedMs / 1000)).toFixed(1),
  );
};

/** Capture a macOS display via screencapture. */
const captureScreen = async (display: string, tmpPath: string): Promise<boolean> => {
  const proc = Bun.spawn(
    ["screencapture", "-D", display, "-x", "-t", "jpg", "-C", tmpPath],
    { stdout: "ignore", stderr: "pipe" },
  );
  const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 3000);
  await proc.exited;
  clearTimeout(killTimer);
  return proc.exitCode === 0;
};

/** Capture a single frame from an AVFoundation camera via ffmpeg. */
const captureCamera = async (index: string, tmpPath: string): Promise<boolean> => {
  const proc = Bun.spawn(
    [
      "ffmpeg", "-y",
      "-f", "avfoundation",
      "-framerate", "30",
      "-video_size", "1280x720",
      "-i", `${index}:none`,
      "-frames:v", "1",
      "-update", "1",
      tmpPath,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const killTimer = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);
  await proc.exited;
  clearTimeout(killTimer);
  return proc.exitCode === 0;
};

/**
 * GET /api/record/preview?type=screen&display=1
 * GET /api/record/preview?type=camera&index=0
 *
 * Captures a JPEG preview frame from either a macOS display (via screencapture)
 * or an AVFoundation camera device (via ffmpeg single-frame capture).
 */
export const handleGetScreenPreview = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "screen";

  const key = type === "camera"
    ? `cam${url.searchParams.get("index") ?? "0"}`
    : `d${url.searchParams.get("display") ?? "1"}`;
  const tmpPath = previewTmpPath(key);

  try {
    let ok: boolean;
    if (type === "camera") {
      ok = await captureCamera(url.searchParams.get("index") ?? "0", tmpPath);
    } else {
      ok = await captureScreen(url.searchParams.get("display") ?? "1", tmpPath);
    }

    if (!ok) {
      return Response.json(
        { success: false, error: `Preview capture failed (${type}). Check permissions.` },
        { status: 500 },
      );
    }

    const imageBuffer = await Bun.file(tmpPath).arrayBuffer();
    unlink(tmpPath).catch(() => {});

    return new Response(imageBuffer, { headers: PREVIEW_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

// ===================================================================
// Capture management — persistent ffmpeg preview (separate from recording)
// ===================================================================

const resetCaptureState = (): void => {
  closeCaptureStreams();
  captureProcess = null;
  captureScreenIndex = null;
  captureLatestFrame = null;
  captureStartedAt = null;
  captureFrameTimestamps = [];
};

/**
 * Reads ffmpeg image2pipe (MJPEG) output from stdout and extracts
 * individual JPEG frames into an in-memory buffer. Only the latest
 * frame is kept so the preview endpoint can serve it instantly.
 *
 * JPEG frames are delimited by SOI (0xFFD8) and EOI (0xFFD9) markers.
 * Within entropy-coded data, 0xFF is always byte-stuffed as 0xFF00,
 * so raw 0xFFD9 only appears as the genuine end-of-image marker.
 */
const consumeCaptureFrames = async (
  proc: CaptureProcess,
): Promise<void> => {
  const reader = proc.stdout.getReader();
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Append incoming data
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      // Extract complete JPEG frames
      while (buffer.length >= 4) {
        // Find SOI
        let soiIdx = -1;
        for (let i = 0; i <= buffer.length - 2; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
            soiIdx = i;
            break;
          }
        }
        if (soiIdx === -1) { buffer = new Uint8Array(0); break; }

        // Trim before SOI
        if (soiIdx > 0) {
          buffer = buffer.slice(soiIdx);
        }

        // Find EOI after the SOI
        let eoiIdx = -1;
        for (let i = 2; i <= buffer.length - 2; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            eoiIdx = i;
            break;
          }
        }
        if (eoiIdx === -1) break; // incomplete — wait for more data

        const frame = buffer.slice(0, eoiIdx + 2);
        const now = Date.now();
        captureLatestFrame = frame;
        recordCaptureFrameTimestamp(now);
        broadcastCaptureFrame(captureLatestFrame);

        buffer = buffer.slice(eoiIdx + 2);
      }

      // Safety cap — don't let partial data grow unbounded
      if (buffer.length > 5 * 1024 * 1024) {
        buffer = buffer.slice(-1024 * 1024);
      }
    }
  } catch {
    // Pipe closed / process killed — expected during stop
  }
};

/** Drain capture stderr to prevent pipe buffer deadlock. */
const drainCaptureStderr = async (
  proc: CaptureProcess,
): Promise<void> => {
  const reader = proc.stderr.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // Expected when process is killed
  }
};

/**
 * Kill orphaned ffmpeg capture processes from previous server instances.
 * These survive server restarts and lock AVFoundation devices, causing
 * new captures to produce zero frames.
 */
const killOrphanedCaptureProcesses = async (): Promise<void> => {
  try {
    const proc = Bun.spawn(
      ["pgrep", "-f", "ffmpeg.*image2pipe.*mjpeg.*pipe:1"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const pids = output.trim().split("\n").filter(Boolean).map(Number);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process may already be dead
      }
    }
    if (pids.length > 0) {
      console.log(`Killed ${pids.length} orphaned capture ffmpeg process(es)`);
    }
  } catch {
    // pgrep returns non-zero when no matches — expected
  }
};

/**
 * POST /api/record/capture/start
 * Starts a persistent ffmpeg process that captures video frames into
 * an in-memory buffer for fast preview delivery.
 * Body: { screenIndex?: number }
 */
export const handleStartCapture = async (req: Request): Promise<Response> => {
  try {
    if (captureProcess !== null) {
      return Response.json(
        { success: false, error: "Capture already active" },
        { status: 409 },
      );
    }

    // Kill orphaned ffmpeg capture processes from previous server instances
    await killOrphanedCaptureProcesses();

    const body = await req.json();
    const screenIndex = body.screenIndex ?? 7;
    captureScreenIndex = screenIndex;

    const devices = await listAvfoundationDevices();
    const selectedDevice = devices.video.find((d) => d.index === screenIndex);
    const isScreen = isScreenVideoDevice(selectedDevice?.name) || screenIndex >= 7;

    const inputArgs = isScreen
      ? [
          "-pixel_format", "nv12",
          "-framerate", `${CAPTURE_TARGET_FPS}`,
          "-capture_cursor", "1",
          "-probesize", "10M",
          "-i", `${screenIndex}:none`,
        ]
      : [
          "-pixel_format", "nv12",
          "-video_size", "1280x720",
          "-framerate", `${CAPTURE_TARGET_FPS}`,
          "-probesize", "5M",
          "-i", `${screenIndex}:none`,
        ];

    captureProcess = Bun.spawn(
      [
        "ffmpeg",
        "-loglevel", "error",
        "-nostats",
        "-f", "avfoundation",
        ...inputArgs,
        "-vf", `fps=${CAPTURE_TARGET_FPS},scale=960:-2`,
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-q:v", "12",
        "pipe:1",
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );

    captureStartedAt = new Date().toISOString();

    // Fire-and-forget: consume frames and drain stderr
    consumeCaptureFrames(captureProcess);
    drainCaptureStderr(captureProcess);

    // Handle unexpected exit
    captureProcess.exited.then((code) => {
      if (captureProcess !== null && code !== 0) {
        console.error(`Capture ffmpeg exited unexpectedly (code ${code})`);
      }
      // Always clean up when process exits
      if (captureProcess !== null) {
        resetCaptureState();
      }
    });

    // Give ffmpeg a moment to initialise
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (captureProcess?.exitCode !== null) {
      const exitCode = captureProcess?.exitCode;
      resetCaptureState();
      return Response.json(
        {
          success: false,
          error: `Capture failed to start (exit code ${exitCode}). Check Screen Recording permission in System Preferences > Privacy & Security.`,
        },
        { status: 500 },
      );
    }

    console.log(
      `Capture started (screen: ${screenIndex}, pid: ${captureProcess?.pid})`,
    );

    return Response.json({
      success: true,
      data: { screenIndex, startedAt: captureStartedAt },
    });
  } catch (error) {
    resetCaptureState();
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/record/capture/stop
 * Gracefully stops the capture preview process.
 */
export const handleStopCapture = async (_req: Request): Promise<Response> => {
  try {
    if (captureProcess === null) {
      return Response.json(
        { success: false, error: "No capture active" },
        { status: 400 },
      );
    }

    const proc = captureProcess;

    let exited = false;

    if (proc.exitCode === null) {
      try {
        proc.stdin.write("q\n");
        proc.stdin.end();
        exited = await waitForProcessExit(proc, CAPTURE_STOP_TIMEOUT_MS);
      } catch {
        // stdin may already be closed
      }
    }

    if (!exited && proc.exitCode === null) {
      try {
        proc.kill("SIGINT");
        exited = await waitForProcessExit(proc, CAPTURE_STOP_TIMEOUT_MS);
      } catch {
        // Process may already be dead
      }
    }

    if (!exited && proc.exitCode === null) {
      try {
        proc.kill("SIGTERM");
        exited = await waitForProcessExit(proc, CAPTURE_STOP_TIMEOUT_MS);
      } catch {
        // Process may already be dead
      }
    }

    if (!exited && proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
        exited = await waitForProcessExit(proc, 1000);
      } catch {
        // ignore
      }
    }

    if (!exited && proc.exitCode !== null) {
      exited = true;
    }

    if (!exited) {
      console.error("Capture ffmpeg did not stop cleanly after q/SIGINT/SIGTERM/SIGKILL");
      resetCaptureState();
      return Response.json(
        {
          success: false,
          error: "Capture stop timed out. The preview was reset locally but ffmpeg may still be shutting down.",
        },
        { status: 500 },
      );
    }

    resetCaptureState();
    console.log("Capture stopped");

    return Response.json({ success: true });
  } catch (error) {
    resetCaptureState();
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * GET /api/record/capture/status
 */
export const handleGetCaptureStatus = (_req: Request): Response => {
  return Response.json({
    success: true,
    data: {
      active: captureProcess !== null,
      screenIndex: captureScreenIndex,
      startedAt: captureStartedAt,
      hasFrame: captureLatestFrame !== null,
      currentFps: captureProcess !== null ? getCaptureCurrentFps() : 0,
      targetFps: CAPTURE_TARGET_FPS,
    },
  });
};

/**
 * GET /api/record/capture/stream
 * Streams the latest JPEG frames as multipart MJPEG so the browser
 * can render the preview without hammering the API with one request/frame.
 */
export const handleGetCaptureStream = (_req: Request): Response => {
  if (!captureProcess) {
    return Response.json(
      { success: false, error: "No capture active" },
      { status: 404 },
    );
  }

  let clientId = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clientId = nextCaptureStreamClientId++;
      captureStreamClients.set(clientId, controller);

      if (captureLatestFrame) {
        controller.enqueue(buildMultipartFrameChunk(captureLatestFrame));
      }
    },
    cancel() {
      if (clientId !== 0) {
        captureStreamClients.delete(clientId);
      }
    },
  });

  return new Response(stream, { headers: CAPTURE_STREAM_HEADERS });
};

/**
 * GET /api/record/capture/frame
 * Returns the latest JPEG frame from the capture buffer.
 * Near-instant response since the data is already in memory.
 */
export const handleGetCaptureFrame = (_req: Request): Response => {
  if (!captureProcess || !captureLatestFrame) {
    return Response.json(
      { success: false, error: "No capture active or no frame available" },
      { status: 404 },
    );
  }

  return new Response(captureLatestFrame, { headers: PREVIEW_HEADERS });
};
