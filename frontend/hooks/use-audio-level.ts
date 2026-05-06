import { useState, useEffect, useRef } from 'react';

interface UseAudioLevelOptions {
  onPermissionGranted?: () => void;
}

/**
 * Monitors microphone audio level using the Web Audio API.
 * Returns a level from 0-100 in real-time using requestAnimationFrame.
 */
export const useAudioLevel = (
  audioDeviceId: string | null,
  enabled: boolean,
  options: UseAudioLevelOptions = {},
): { level: number; error: string | null } => {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const hasReportedPermissionRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      setError(null);
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        setError(null);

        const constraints: MediaStreamConstraints = {
          audio: audioDeviceId && audioDeviceId !== 'default'
            ? { deviceId: { exact: audioDeviceId } }
            : true,
          video: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (!hasReportedPermissionRef.current) {
          hasReportedPermissionRef.current = true;
          options.onPermissionGranted?.();
        }

        streamRef.current = stream;
        const ctx = new AudioContext();
        contextRef.current = ctx;

        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {
            // Safari/WebKit can require a user gesture; if resume fails we keep going
            // and the next interaction will re-trigger the hook.
          });
        }

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.25;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.fftSize);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(dataArray);

          let sumSquares = 0;
          for (const value of dataArray) {
            const normalized = (value - 128) / 128;
            sumSquares += normalized * normalized;
          }

          const rms = Math.sqrt(sumSquares / dataArray.length);
          setLevel(Math.min(100, rms * 220));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error de acceso al micrófono');
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      contextRef.current?.close();
      contextRef.current = null;
      setLevel(0);
    };
  }, [audioDeviceId, enabled, options.onPermissionGranted]);

  return { level, error };
};
