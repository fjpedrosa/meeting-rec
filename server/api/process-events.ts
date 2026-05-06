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

// Stop tracking
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
