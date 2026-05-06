# Processing Progress Feedback System

## Context

When a user processes a meeting (video → audio → transcription → diarization → speaker identification), there is no real-time feedback. The pipeline takes 3-7 minutes and the user has no visibility into what's happening.

## Decision

Add real-time progress feedback via SSE (Server-Sent Events) with three layers:

1. Python pipeline emits structured JSON to stdout
2. Bun server reads stdout stream, maintains state in memory, pushes SSE events
3. Frontend consumes SSE via shared Context, renders inline progress + floating widget

## Architecture

```
Python stdout (JSON lines)
    ↓
Bun process.ts reads pipe line-by-line
    ↓
In-memory Map<meetingId, ProcessingState>
    ↓
SSE endpoint GET /api/process/events
    ↓
EventSource in use-processing-progress hook
    ↓
React Context (shared across all pages)
    ↓
┌─────────────────────────────┐
│ ProcessingProgress (inline) │  ← recording page + meetings page
│ ProcessingWidget (floating) │  ← always visible, minimizable
└─────────────────────────────┘
```

## Pipeline stdout protocol

Two event types:

```json
{"type": "progress", "step": "transcribing", "message": "Transcribiendo audio...", "progress": 20}
{"type": "log", "message": "Loaded Whisper large-v3-turbo model"}
{"type": "complete", "message": "Procesamiento completado", "progress": 100}
{"type": "error", "message": "Error details..."}
```

Steps with estimated progress: extracting_audio (0-15%) → transcribing (15-50%) → diarizing (50-70%) → identifying (70-80%) → storing (80-90%) → generating (90-100%).

## SSE endpoint

`GET /api/process/events` returns `text/event-stream`. On connect, sends current state of all active processings. Then pushes each new event as it arrives. Events include meetingId.

## Frontend components

- `use-processing-progress.ts` — EventSource hook with reconnect backoff, shared via Context
- `ProcessingProgress` — Inline bar with steps, message, collapsible log console
- `ProcessingWidget` — Fixed bottom-right, expandable/minimizable, always visible during processing, auto-hides after completion

## Files to create/modify

### New files
- `server/api/process-events.ts` — SSE logic, state Map, listener management
- `frontend/hooks/use-processing-progress.ts` — SSE hook + state
- `frontend/components/processing-progress.tsx` — Inline progress (JSX only)
- `frontend/components/processing-widget.tsx` — Floating widget (JSX only)
- `frontend/containers/processing-progress-container.tsx` — Connects hook to inline component
- `frontend/containers/processing-widget-container.tsx` — Connects hook to widget

### Modified files
- `pipeline/process_meeting.py` — Add JSON stdout emissions at each step
- `server/api/process.ts` — Read stdout pipe, feed events to process-events module
- `server/index.ts` — Register SSE endpoint
- `frontend/app.tsx` — Add Context provider + ProcessingWidget
- `frontend/api/client.ts` — Add SSE connection helper type
