# Processing Progress Feedback — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give users real-time progress feedback (bar, spinner, logs) when processing meetings, visible from any page.

**Architecture:** Python pipeline emits JSON lines to stdout → Bun reads the pipe in streaming, stores state in an in-memory Map, and pushes events via SSE → Frontend connects via EventSource, shares state through React Context, renders an inline progress component and a persistent floating widget.

**Tech Stack:** Python stdout JSON protocol, Bun.serve() SSE, React Context + EventSource, CSS for widget/progress bar.

---

### Task 1: Python pipeline — emit structured JSON to stdout

**Files:**
- Modify: `pipeline/process_meeting.py`

**Step 1: Add a `emit_progress` helper and wrap every step**

In `process_meeting.py`, add a helper function at the top and emit events at each pipeline step. Regular `print()` calls become `emit_log()`.

```python
import json as _json
import sys

def emit_progress(step: str, message: str, progress: int) -> None:
    """Emit a structured progress event to stdout for the Bun server to read."""
    print(_json.dumps({"type": "progress", "step": step, "message": message, "progress": progress}), flush=True)

def emit_log(message: str) -> None:
    """Emit a log line to stdout for the Bun server to read."""
    print(_json.dumps({"type": "log", "message": message}), flush=True)

def emit_complete(message: str) -> None:
    print(_json.dumps({"type": "complete", "message": message, "progress": 100}), flush=True)

def emit_error(message: str) -> None:
    print(_json.dumps({"type": "error", "message": message}), flush=True)
```

Then replace existing print statements in `main()`:

```python
def main():
    # ... (argparse, setup, same as before) ...

    emit_progress("initializing", "Preparando pipeline...", 0)
    emit_log(f"Processing: {folder_name}")
    emit_log(f"  File: {mp3_path}")
    emit_log(f"  Date: {meeting_date}")

    meeting_id = insert_meeting(conn, folder_name, mp3_path, args.language or "es", meeting_date)

    try:
        # Step 1: Transcribe + diarize
        emit_progress("transcribing", "Transcribiendo y diarizando audio...", 15)
        segments, duration = transcribe_and_diarize(mp3_path, language=args.language, hf_token=hf_token)
        emit_log(f"Got {len(segments)} segments, {duration:.0f}s duration")

        # Step 2: Extract speaker embeddings
        emit_progress("extracting_embeddings", "Extrayendo embeddings de speakers...", 50)
        speaker_embeddings = extract_speaker_embeddings(
            mp3_path, segments, meeting_id, clips_dir, hf_token=hf_token
        )
        emit_log(f"Found {len(speaker_embeddings)} speakers")

        # Step 3: Identify speakers
        emit_progress("identifying", "Identificando speakers...", 70)
        speaker_names = identify_speakers(conn, speaker_embeddings)

        # Step 4: Store participants and unknown speakers
        emit_progress("storing", "Guardando participantes...", 80)
        for speaker_label, (profile_id, display_name) in speaker_names.items():
            is_identified = profile_id is not None
            insert_participant(conn, meeting_id, display_name, profile_id, is_identified)

            if not is_identified:
                embedding, clip_path = speaker_embeddings.get(speaker_label, (None, None))
                if embedding is not None:
                    insert_unknown_speaker(conn, meeting_id, display_name, embedding, clip_path)
            else:
                embedding, _ = speaker_embeddings.get(speaker_label, (None, None))
                if embedding is not None:
                    insert_voice_embedding(conn, profile_id, embedding, meeting_id)

        # Step 5: Generate transcript
        emit_progress("generating", "Generando transcripcion...", 90)
        transcript_text = generate_transcript(segments, speaker_names)
        transcript_path = str(mp3_dir / f"{Path(mp3_path).stem}.txt")
        write_transcript(transcript_path, transcript_text)

        # Update meeting status
        update_meeting_completed(conn, meeting_id, transcript_path, int(duration))

        emit_complete(f"Meeting procesada: {folder_name}")
        notify("Meeting Transcribed", f"{folder_name} - Ready for review")

    except Exception as e:
        import traceback
        error_msg = f"{e}\n{traceback.format_exc()}"
        update_meeting_error(conn, meeting_id, error_msg)
        emit_error(str(e))
        notify("Meeting Transcription Error", f"{folder_name} - Check logs")
        raise
    finally:
        conn.close()
```

**Step 2: Verify pipeline still works**

Run: `cd /Users/javi/projects/experimento && pipeline/.venv/bin/python pipeline/process_meeting.py --help`
Expected: Help text prints without errors.

---

### Task 2: Server — SSE event system (`process-events.ts`)

**Files:**
- Create: `server/api/process-events.ts`

**Step 1: Create the SSE module**

This module manages: (1) in-memory state of active processings, (2) SSE listener registration, (3) broadcasting events to all connected clients.

```typescript
// server/api/process-events.ts

// Types for processing events
export interface ProcessingEvent {
  meetingId: number;
  type: 'progress' | 'log' | 'complete' | 'error';
  step?: string;
  message: string;
  progress?: number;
  timestamp: number;
}

export interface ProcessingState {
  meetingId: number;
  step: string;
  message: string;
  progress: number;
  logs: string[];
  startedAt: number;
}

// In-memory state
const activeProcessings = new Map<number, ProcessingState>();
const sseListeners = new Set<(event: ProcessingEvent) => void>();

// Register a new processing
export const startTracking = (meetingId: number): void => {
  activeProcessings.set(meetingId, {
    meetingId,
    step: 'initializing',
    message: 'Iniciando...',
    progress: 0,
    logs: [],
    startedAt: Date.now(),
  });
};

// Push an event from the pipeline stdout
export const pushEvent = (meetingId: number, raw: { type: string; step?: string; message: string; progress?: number }): void => {
  const state = activeProcessings.get(meetingId);
  if (!state) return;

  if (raw.type === 'progress') {
    state.step = raw.step || state.step;
    state.message = raw.message;
    state.progress = raw.progress ?? state.progress;
  } else if (raw.type === 'log') {
    state.logs.push(raw.message);
  } else if (raw.type === 'complete') {
    state.step = 'complete';
    state.message = raw.message;
    state.progress = 100;
  } else if (raw.type === 'error') {
    state.step = 'error';
    state.message = raw.message;
  }

  const event: ProcessingEvent = {
    meetingId,
    type: raw.type as ProcessingEvent['type'],
    step: raw.step,
    message: raw.message,
    progress: raw.progress,
    timestamp: Date.now(),
  };

  // Broadcast to all SSE listeners
  for (const listener of sseListeners) {
    listener(event);
  }

  // Cleanup after terminal events (with delay so clients see it)
  if (raw.type === 'complete' || raw.type === 'error') {
    setTimeout(() => activeProcessings.delete(meetingId), 10_000);
  }
};

// Stop tracking (e.g., if process exits unexpectedly)
export const stopTracking = (meetingId: number): void => {
  activeProcessings.delete(meetingId);
};

// Get all active processings (for initial SSE sync)
export const getActiveProcessings = (): ProcessingState[] => {
  return Array.from(activeProcessings.values());
};

// SSE endpoint handler
export const handleProcessEvents = (req: Request): Response => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state on connect
      const active = getActiveProcessings();
      if (active.length > 0) {
        const initData = `data: ${JSON.stringify({ type: 'init', processings: active })}\n\n`;
        controller.enqueue(encoder.encode(initData));
      }

      // Register listener for new events
      const listener = (event: ProcessingEvent) => {
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // Client disconnected
          sseListeners.delete(listener);
        }
      };

      sseListeners.add(listener);

      // Keepalive every 30s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
          sseListeners.delete(listener);
        }
      }, 30_000);

      // Cleanup on abort
      req.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        sseListeners.delete(listener);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
```

**Step 2: Verify file compiles**

Run: `cd /Users/javi/projects/experimento && bun build server/api/process-events.ts --no-bundle 2>&1 | head -5`
Expected: No type errors.

---

### Task 3: Server — Wire stdout pipe to SSE events in `process.ts`

**Files:**
- Modify: `server/api/process.ts:96-119` (the spawn + exited handler section)

**Step 1: Change spawn to pipe stdout, read lines, and push events**

Replace the `Bun.spawn()` section and `.exited` handler with:

```typescript
import { startTracking, pushEvent, stopTracking } from "./process-events";

// Inside handleProcessMov, after ffmpeg extraction and env setup:

// We need the meetingId to associate events.
// Query the DB for the most recent pending meeting with this mp3_path.
const meetingRow = db.query("SELECT id FROM meetings WHERE mp3_path = ? ORDER BY id DESC LIMIT 1").get(mp3Path) as { id: number } | null;

console.log(`Starting pipeline for ${mp3Path}...`);

const pipelineProc = Bun.spawn(
  [join(VENV_DIR, "bin", "python"), "-u", PIPELINE_SCRIPT, mp3Path, "--db", DB_PATH, ...langArgs],
  { env, stdout: "pipe", stderr: "pipe" }
);

// Start tracking — use meetingId if we have it, otherwise 0 (will update)
let meetingId = meetingRow?.id ?? 0;

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

        // If we didn't have meetingId initially, try to get it now
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

// Start tracking immediately if we have meetingId
if (meetingId > 0) {
  startTracking(meetingId);
}

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
    // Push error if pipeline crashed without emitting one
    if (meetingId > 0) {
      pushEvent(meetingId, { type: 'error', message: `Pipeline exited with code ${code}` });
    }
  }
});
```

Note: Add `-u` flag to python command for unbuffered stdout (critical for real-time streaming).

**Step 2: Verify server starts without errors**

Run: `cd /Users/javi/projects/experimento && timeout 3 bun --hot index.ts 2>&1 || true`
Expected: "Server running on http://localhost:3456" without errors.

---

### Task 4: Server — Register SSE endpoint in `index.ts`

**Files:**
- Modify: `server/index.ts:6` (imports) and `server/index.ts:41-44` (routes)

**Step 1: Add import and route**

Add import at top:
```typescript
import { handleProcessEvents } from "./api/process-events";
```

Add route after the existing `/api/process` block:
```typescript
"/api/process/events": {
  GET: handleProcessEvents,
},
```

---

### Task 5: Frontend — Processing progress hook and Context

**Files:**
- Create: `frontend/hooks/use-processing-progress.ts`

**Step 1: Create the hook with EventSource + Context**

```typescript
// frontend/hooks/use-processing-progress.ts
import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';

// Types
export interface ProcessingState {
  meetingId: number;
  step: string;
  message: string;
  progress: number;
  logs: string[];
  startedAt: number;
}

export interface ProcessingEvent {
  meetingId: number;
  type: 'progress' | 'log' | 'complete' | 'error' | 'init';
  step?: string;
  message: string;
  progress?: number;
  processings?: ProcessingState[];
}

interface ProcessingProgressState {
  processings: Map<number, ProcessingState>;
  connected: boolean;
}

interface ProcessingProgressContextValue {
  processings: ProcessingState[];
  hasActive: boolean;
  connected: boolean;
}

// Context
export const ProcessingProgressContext = createContext<ProcessingProgressContextValue>({
  processings: [],
  hasActive: false,
  connected: false,
});

export const useProcessingProgress = (): ProcessingProgressContextValue => {
  return useContext(ProcessingProgressContext);
};

// Provider hook — call this once in App
export const useProcessingProgressProvider = (): ProcessingProgressContextValue => {
  const [state, setState] = useState<ProcessingProgressState>({
    processings: new Map(),
    connected: false,
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/process/events');
    eventSourceRef.current = es;

    es.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
      reconnectDelayRef.current = 1000; // Reset backoff
    };

    es.onmessage = (event) => {
      try {
        const data: ProcessingEvent = JSON.parse(event.data);

        setState(prev => {
          const next = new Map(prev.processings);

          if (data.type === 'init' && data.processings) {
            // Initial sync — replace all
            for (const p of data.processings) {
              next.set(p.meetingId, p);
            }
          } else if (data.type === 'progress') {
            const existing = next.get(data.meetingId);
            if (existing) {
              next.set(data.meetingId, {
                ...existing,
                step: data.step || existing.step,
                message: data.message,
                progress: data.progress ?? existing.progress,
              });
            } else {
              next.set(data.meetingId, {
                meetingId: data.meetingId,
                step: data.step || 'initializing',
                message: data.message,
                progress: data.progress ?? 0,
                logs: [],
                startedAt: Date.now(),
              });
            }
          } else if (data.type === 'log') {
            const existing = next.get(data.meetingId);
            if (existing) {
              next.set(data.meetingId, {
                ...existing,
                logs: [...existing.logs, data.message],
              });
            }
          } else if (data.type === 'complete') {
            const existing = next.get(data.meetingId);
            if (existing) {
              next.set(data.meetingId, {
                ...existing,
                step: 'complete',
                message: data.message,
                progress: 100,
              });
            }
            // Remove after delay
            setTimeout(() => {
              setState(prev => {
                const cleaned = new Map(prev.processings);
                cleaned.delete(data.meetingId);
                return { ...prev, processings: cleaned };
              });
            }, 8_000);
          } else if (data.type === 'error') {
            const existing = next.get(data.meetingId);
            if (existing) {
              next.set(data.meetingId, {
                ...existing,
                step: 'error',
                message: data.message,
              });
            }
            setTimeout(() => {
              setState(prev => {
                const cleaned = new Map(prev.processings);
                cleaned.delete(data.meetingId);
                return { ...prev, processings: cleaned };
              });
            }, 15_000);
          }

          return { ...prev, processings: next };
        });
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
      es.close();
      eventSourceRef.current = null;

      // Reconnect with backoff
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30_000);
        connect();
      }, reconnectDelayRef.current);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  const processings = Array.from(state.processings.values());
  const hasActive = processings.some(p => p.step !== 'complete' && p.step !== 'error');

  return { processings, hasActive, connected: state.connected };
};
```

---

### Task 6: Frontend — Inline progress component

**Files:**
- Create: `frontend/components/processing-progress.tsx`

**Step 1: Create the presentational component**

```tsx
// frontend/components/processing-progress.tsx
import React from 'react';
import type { ProcessingState } from '../hooks/use-processing-progress';

interface ProcessingProgressProps {
  processing: ProcessingState;
  showLogs: boolean;
  onToggleLogs: () => void;
}

const STEP_LABELS: Record<string, string> = {
  initializing: 'Iniciando',
  transcribing: 'Transcribiendo',
  extracting_embeddings: 'Extrayendo embeddings',
  identifying: 'Identificando speakers',
  storing: 'Guardando datos',
  generating: 'Generando transcripcion',
  complete: 'Completado',
  error: 'Error',
};

const STEPS = ['initializing', 'transcribing', 'extracting_embeddings', 'identifying', 'storing', 'generating'];

export const ProcessingProgress: React.FC<ProcessingProgressProps> = ({ processing, showLogs, onToggleLogs }) => {
  const isComplete = processing.step === 'complete';
  const isError = processing.step === 'error';
  const currentStepIndex = STEPS.indexOf(processing.step);

  return (
    <div className={`processing-progress ${isComplete ? 'processing-complete' : ''} ${isError ? 'processing-error' : ''}`}>
      <div className="processing-header">
        <div className="processing-status">
          {!isComplete && !isError && <div className="loading-spinner" style={{ width: 16, height: 16 }} />}
          {isComplete && <span className="processing-icon-done">&#10003;</span>}
          {isError && <span className="processing-icon-error">&#10007;</span>}
          <span className="processing-message">{processing.message}</span>
        </div>
        <span className="processing-percent">{processing.progress}%</span>
      </div>

      {/* Progress bar */}
      <div className="processing-bar-track">
        <div
          className={`processing-bar-fill ${isComplete ? 'bar-complete' : ''} ${isError ? 'bar-error' : ''}`}
          style={{ width: `${processing.progress}%` }}
        />
      </div>

      {/* Step indicators */}
      <div className="processing-steps">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className={`processing-step ${i < currentStepIndex ? 'step-done' : ''} ${i === currentStepIndex ? 'step-active' : ''}`}
          >
            <div className="step-dot" />
            <span className="step-label">{STEP_LABELS[step]}</span>
          </div>
        ))}
      </div>

      {/* Logs toggle */}
      {processing.logs.length > 0 && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={onToggleLogs} style={{ marginTop: 8 }}>
            {showLogs ? 'Ocultar logs' : `Ver logs (${processing.logs.length})`}
          </button>
          {showLogs && (
            <div className="processing-logs">
              {processing.logs.map((log, i) => (
                <div key={i} className="processing-log-line">{log}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
```

---

### Task 7: Frontend — Floating widget component

**Files:**
- Create: `frontend/components/processing-widget.tsx`

**Step 1: Create the floating widget**

```tsx
// frontend/components/processing-widget.tsx
import React from 'react';
import type { ProcessingState } from '../hooks/use-processing-progress';
import { ProcessingProgress } from './processing-progress';

interface ProcessingWidgetProps {
  processings: ProcessingState[];
  minimized: boolean;
  onToggleMinimize: () => void;
  logsVisible: Record<number, boolean>;
  onToggleLogs: (meetingId: number) => void;
}

export const ProcessingWidget: React.FC<ProcessingWidgetProps> = ({
  processings,
  minimized,
  onToggleMinimize,
  logsVisible,
  onToggleLogs,
}) => {
  if (processings.length === 0) return null;

  const activeCount = processings.filter(p => p.step !== 'complete' && p.step !== 'error').length;
  const mainProcessing = processings[0];

  if (minimized) {
    return (
      <div className="processing-widget-minimized" onClick={onToggleMinimize}>
        <div className="loading-spinner" style={{ width: 14, height: 14 }} />
        <span>{mainProcessing.progress}%</span>
        {activeCount > 1 && <span className="processing-widget-badge">+{activeCount - 1}</span>}
      </div>
    );
  }

  return (
    <div className="processing-widget">
      <div className="processing-widget-header">
        <span className="processing-widget-title">
          Procesando {activeCount > 1 ? `(${activeCount})` : ''}
        </span>
        <button className="btn-icon" onClick={onToggleMinimize} title="Minimizar">
          &#8211;
        </button>
      </div>
      <div className="processing-widget-body">
        {processings.map(p => (
          <ProcessingProgress
            key={p.meetingId}
            processing={p}
            showLogs={!!logsVisible[p.meetingId]}
            onToggleLogs={() => onToggleLogs(p.meetingId)}
          />
        ))}
      </div>
    </div>
  );
};
```

---

### Task 8: Frontend — Widget container with state

**Files:**
- Create: `frontend/containers/processing-widget-container.tsx`

**Step 1: Create the container that connects the hook to the widget**

```tsx
// frontend/containers/processing-widget-container.tsx
import React, { useState, useCallback } from 'react';
import { useProcessingProgress } from '../hooks/use-processing-progress';
import { ProcessingWidget } from '../components/processing-widget';

export const ProcessingWidgetContainer: React.FC = () => {
  const { processings } = useProcessingProgress();
  const [minimized, setMinimized] = useState(false);
  const [logsVisible, setLogsVisible] = useState<Record<number, boolean>>({});

  const handleToggleMinimize = useCallback(() => {
    setMinimized(prev => !prev);
  }, []);

  const handleToggleLogs = useCallback((meetingId: number) => {
    setLogsVisible(prev => ({ ...prev, [meetingId]: !prev[meetingId] }));
  }, []);

  return (
    <ProcessingWidget
      processings={processings}
      minimized={minimized}
      onToggleMinimize={handleToggleMinimize}
      logsVisible={logsVisible}
      onToggleLogs={handleToggleLogs}
    />
  );
};
```

---

### Task 9: Frontend — Wire into `app.tsx`

**Files:**
- Modify: `frontend/app.tsx`

**Step 1: Add Context Provider and Widget**

Add imports:
```typescript
import { ProcessingProgressContext, useProcessingProgressProvider } from './hooks/use-processing-progress';
import { ProcessingWidgetContainer } from './containers/processing-widget-container';
```

Wrap the App component's return with the Context provider, and add the widget after `<main>`:

```tsx
const App: React.FC = () => {
  const [route, setRoute] = useState(window.location.hash || '#/');
  const processingProgress = useProcessingProgressProvider();

  // ... (existing useEffect and navigate unchanged) ...

  return (
    <ProcessingProgressContext.Provider value={processingProgress}>
      <div className="app">
        <Nav currentPage={routeMatch.page} onNavigate={navigate} />
        <main className="main">{renderPage()}</main>
        <ProcessingWidgetContainer />
      </div>
    </ProcessingProgressContext.Provider>
  );
};
```

---

### Task 10: Frontend — CSS for progress bar and widget

**Files:**
- Modify: `frontend/styles.css` (append at end)

**Step 1: Add all processing-related styles**

```css
/* Processing Progress */
.processing-progress {
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
}

.processing-progress + .processing-progress {
  margin-top: var(--spacing-sm);
}

.processing-complete {
  background: rgba(22, 163, 74, 0.06);
}

.processing-error {
  background: rgba(220, 38, 38, 0.06);
}

.processing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.processing-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.processing-message {
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.processing-percent {
  font-size: var(--font-size-sm);
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.processing-icon-done {
  color: var(--success);
  font-weight: 700;
}

.processing-icon-error {
  color: var(--error);
  font-weight: 700;
}

/* Progress bar */
.processing-bar-track {
  height: 6px;
  background: var(--border-light);
  border-radius: 3px;
  overflow: hidden;
}

.processing-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.bar-complete {
  background: var(--success);
}

.bar-error {
  background: var(--error);
}

/* Step indicators */
.processing-steps {
  display: flex;
  justify-content: space-between;
  margin-top: var(--spacing-sm);
  gap: var(--spacing-xs);
}

.processing-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-color);
  transition: background 0.3s;
}

.step-done .step-dot {
  background: var(--success);
}

.step-active .step-dot {
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}

.step-label {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-align: center;
  white-space: nowrap;
}

.step-active .step-label {
  color: var(--accent);
  font-weight: 500;
}

.step-done .step-label {
  color: var(--success);
}

/* Logs */
.processing-logs {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: #1a1a1a;
  border-radius: var(--radius-md);
  max-height: 200px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
}

.processing-log-line {
  color: #a0a0a0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Floating widget */
.processing-widget {
  position: fixed;
  bottom: var(--spacing-lg);
  right: var(--spacing-lg);
  width: 380px;
  max-height: 500px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 200;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.processing-widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-tertiary);
}

.processing-widget-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.processing-widget-body {
  padding: var(--spacing-sm);
  overflow-y: auto;
  max-height: 420px;
}

.processing-widget-minimized {
  position: fixed;
  bottom: var(--spacing-lg);
  right: var(--spacing-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  box-shadow: var(--shadow-md);
  z-index: 200;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 500;
  font-family: var(--font-mono);
  transition: box-shadow 0.15s;
}

.processing-widget-minimized:hover {
  box-shadow: var(--shadow-lg);
}

.processing-widget-badge {
  background: var(--accent);
  color: white;
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 9999px;
}
```

---

### Task 11: Integration — Update `meetings-page.tsx` to use SSE progress

**Files:**
- Modify: `frontend/pages/meetings-page.tsx`

**Step 1: Replace polling with SSE-based progress**

Import and use the hook:
```typescript
import { useProcessingProgress } from '../hooks/use-processing-progress';
```

Inside the component, add:
```typescript
const { processings } = useProcessingProgress();
```

Replace the polling logic in `handleProcess`: remove the `setInterval` polling block entirely. The SSE system handles progress tracking. Keep `setStep('processing')` to show the form state, but remove the `pollRef` interval. Also, when a processing for the current meeting completes (detected via `processings`), refresh the meetings list:

```typescript
// Add useEffect to watch for processing completion
useEffect(() => {
  const completedOrError = processings.find(
    p => (p.step === 'complete' || p.step === 'error') && movPath && p.meetingId > 0
  );
  if (completedOrError) {
    loadMeetings();
    if (completedOrError.step === 'complete') {
      setStep('done');
    }
  }
}, [processings]);
```

Remove `pollRef` references (useRef, clearInterval in useEffect cleanup, and in handleProcess/handleReset).

**Step 2: Add inline progress display**

Import ProcessingProgress:
```typescript
import { ProcessingProgress } from '../components/processing-progress';
```

In the JSX where the current indeterminate progress bar is (lines 244-275), replace it with:
```tsx
{processings.length > 0 && (step === 'extracting' || step === 'processing') && (
  <div style={{ marginTop: 16 }}>
    {processings.map(p => (
      <ProcessingProgress
        key={p.meetingId}
        processing={p}
        showLogs={false}
        onToggleLogs={() => {}}
      />
    ))}
  </div>
)}
```

---

### Task 12: Smoke test — End-to-end verification

**Step 1: Start the server**

Run: `cd /Users/javi/projects/experimento && bun --hot index.ts`
Expected: "Server running on http://localhost:3456"

**Step 2: Verify SSE endpoint responds**

Run (in another terminal): `curl -N http://localhost:3456/api/process/events`
Expected: Connection stays open (SSE stream). No errors. Receives keepalive comments.

**Step 3: Verify UI renders**

Open http://localhost:3456 in browser. Verify:
- No console errors
- No floating widget visible (no active processings)
- Meetings page loads normally

**Step 4: Test with a real recording (if available)**

Process a .mov file and verify:
- Progress bar appears inline in the process form
- Floating widget appears bottom-right
- Steps advance with correct messages
- Logs expandable
- Widget minimizable
- Auto-disappears after completion

---

## Execution Order

```
Task 1  (Python stdout)           — independent
Task 2  (SSE module)              — independent
  ↓
Task 3  (Wire pipe → SSE)        — depends on Task 2
Task 4  (Register route)          — depends on Task 2
  ↓
Task 5  (Hook + Context)          — independent of server tasks
Task 6  (Inline component)        — depends on Task 5 types
Task 7  (Widget component)        — depends on Task 6
Task 8  (Widget container)        — depends on Task 5, 7
  ↓
Task 9  (Wire into app.tsx)       — depends on Task 5, 8
Task 10 (CSS)                     — independent
Task 11 (Update meetings-page)    — depends on Task 5, 6
  ↓
Task 12 (Smoke test)              — depends on all
```

**Parallelizable groups:**
- Phase 1: Tasks 1, 2, 5, 10 (all independent)
- Phase 2: Tasks 3, 4, 6 (light dependencies)
- Phase 3: Tasks 7, 8, 11
- Phase 4: Task 9
- Phase 5: Task 12
