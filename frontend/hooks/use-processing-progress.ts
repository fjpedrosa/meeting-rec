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
      reconnectDelayRef.current = 1000;
    };

    es.onmessage = (event) => {
      try {
        const data: ProcessingEvent = JSON.parse(event.data);

        setState(prev => {
          const next = new Map(prev.processings);

          if (data.type === 'init' && data.processings) {
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
