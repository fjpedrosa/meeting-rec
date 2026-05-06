import index from "../frontend/index.html";
import { db } from "./db";
import { handleGetMeetings, handleGetMeeting, handleUpdateMeeting, handleGetTranscription, handleGetStructuredTranscription, handleDownloadTranscription, handleArchiveMeeting, handleRediarize, handleRetryMeeting } from "./api/meetings";
import { handleGetProfiles, handleCreateProfile, handleGetProfile, handleGetProfileSamples, handleDeleteProfile, handleReassignSample, handleUpdateProfile } from "./api/profiles";
import { handleGetUnknownSpeakers, handleAssignSpeaker, handleCreateProfileFromUnknown, handleDiscardSpeaker } from "./api/speakers";
import { handlePickFile, handleProcessMov } from "./api/process";
import { handleProcessEvents } from "./api/process-events";
import { handleGetDevices, handleUploadRecording, handleStartRecording, handleStopRecording, handleGetStatus, handleGetScreenPreview, handleStartCapture, handleStopCapture, handleGetCaptureStatus, handleGetCaptureFrame, handleGetCaptureStream } from "./api/record";
import { handleGetTags, handleCreateTag, handleUpdateTag, handleDeleteTag, handleAssignTag, handleRemoveTag } from "./api/tags";
import { join } from "path";

const CLIPS_DIR = join(import.meta.dir, "..", "data", "clips");

Bun.serve({
  port: Number(Bun.env.PORT) || 3456,
  idleTimeout: 120, // seconds — needed for native file picker dialog
  routes: {
    "/": index,

    "/api/meetings": {
      GET: handleGetMeetings,
    },
    "/api/meetings/:id": {
      GET: handleGetMeeting,
      PATCH: handleUpdateMeeting,
      DELETE: handleArchiveMeeting,
    },
    "/api/meetings/:id/transcription": {
      GET: handleGetTranscription,
    },
    "/api/meetings/:id/transcription-structured": {
      GET: handleGetStructuredTranscription,
    },
    "/api/meetings/:id/transcription/download": {
      GET: handleDownloadTranscription,
    },
    "/api/meetings/:id/rediarize": {
      POST: handleRediarize,
    },
    "/api/meetings/:id/retry": {
      POST: handleRetryMeeting,
    },
    "/api/meetings/:id/tags": {
      POST: handleAssignTag,
    },
    "/api/meetings/:id/tags/:tagId": {
      DELETE: handleRemoveTag,
    },

    "/api/profiles": {
      GET: handleGetProfiles,
      POST: handleCreateProfile,
    },
    "/api/profiles/:id": {
      GET: handleGetProfile,
      PATCH: handleUpdateProfile,
      DELETE: handleDeleteProfile,
    },
    "/api/profiles/:id/samples": {
      GET: handleGetProfileSamples,
    },
    "/api/profiles/samples/:id/reassign": {
      POST: handleReassignSample,
    },

    "/api/tags": {
      GET: handleGetTags,
      POST: handleCreateTag,
    },
    "/api/tags/:id": {
      PATCH: handleUpdateTag,
      DELETE: handleDeleteTag,
    },

    "/api/process": {
      POST: handleProcessMov,
    },
    "/api/process/pick-file": {
      GET: handlePickFile,
    },
    "/api/process/events": {
      GET: handleProcessEvents,
    },

    "/api/record/devices": {
      GET: handleGetDevices,
    },
    "/api/record/upload": {
      POST: handleUploadRecording,
    },
    "/api/record/start": {
      POST: handleStartRecording,
    },
    "/api/record/stop": {
      POST: handleStopRecording,
    },
    "/api/record/status": {
      GET: handleGetStatus,
    },
    "/api/record/preview": {
      GET: handleGetScreenPreview,
    },
    "/api/record/capture/start": {
      POST: handleStartCapture,
    },
    "/api/record/capture/stop": {
      POST: handleStopCapture,
    },
    "/api/record/capture/status": {
      GET: handleGetCaptureStatus,
    },
    "/api/record/capture/frame": {
      GET: handleGetCaptureFrame,
    },
    "/api/record/capture/stream": {
      GET: handleGetCaptureStream,
    },

    "/api/unknown-speakers": {
      GET: handleGetUnknownSpeakers,
    },
    "/api/unknown-speakers/:id/assign": {
      POST: handleAssignSpeaker,
    },
    "/api/unknown-speakers/:id/create-profile": {
      POST: handleCreateProfileFromUnknown,
    },
    "/api/unknown-speakers/:id/discard": {
      POST: handleDiscardSpeaker,
    },

    "/api/clips/*": {
      GET: async (req) => {
        const url = new URL(req.url);
        const clipPath = url.pathname.replace("/api/clips/", "");
        const filePath = join(CLIPS_DIR, clipPath);
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "audio/wav" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

const port = Number(Bun.env.PORT) || 3456;
console.log(`Server running on http://localhost:${port}`);
