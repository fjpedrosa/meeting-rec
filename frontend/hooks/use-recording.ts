import { useState, useEffect, useCallback, useRef } from 'react';
import { processMovFile, uploadRecording } from '../api/client';
import type { AudioSourceOption, RecordingDevices, VideoSourceOption } from '../types/recording';
import { useAudioLevel } from './use-audio-level';

interface UseRecordingReturn {
  recording: boolean;
  elapsed: number;
  error: string | null;
  devices: RecordingDevices | null;
  recordingPath: string | null;
  selectedVideoSourceId: string;
  selectedAudioId: string;
  audioLevel: number;
  audioLevelError: string | null;
  captureActive: boolean;
  captureBusy: boolean;
  captureStartedAt: string | null;
  captureFps: number;
  captureTargetFps: number;
  previewStream: MediaStream | null;
  handleVideoSourceChange: (id: string) => void;
  handleAudioChange: (id: string) => void;
  loadDevices: () => Promise<void>;
  handleStart: () => Promise<void>;
  handleStop: () => Promise<string | null>;
  handleProcessRecording: () => Promise<void>;
  handleStartCapture: () => Promise<void>;
  handleStopCapture: () => Promise<void>;
}

const SCREEN_SOURCE_ID = 'screen';
const CAPTURE_TARGET_FPS = 30;
const MIN_ACCEPTABLE_CAMERA_FPS = 24;

const CAMERA_PROFILES = [
  { width: 1280, height: 720 },
  { width: 960, height: 540 },
  { width: 640, height: 480 },
] as const;

const stopMediaStream = (stream: MediaStream | null): void => {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
};

const getVideoTrack = (stream: MediaStream | null): MediaStreamTrack | null => {
  return stream?.getVideoTracks()[0] ?? null;
};

const getTrackFrameRate = (stream: MediaStream | null): number => {
  const frameRate = getVideoTrack(stream)?.getSettings().frameRate;
  return typeof frameRate === 'number' && Number.isFinite(frameRate)
    ? Number(frameRate.toFixed(1))
    : 0;
};

const preferredMimeTypes = [
  'video/mp4;codecs=h264,aac',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

const pickRecorderMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
};

const extensionFromMimeType = (mimeType: string): string => {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  return 'webm';
};

const buildUploadedFilename = (sourceKind: VideoSourceOption['kind'], mimeType: string): string => {
  const extension = extensionFromMimeType(mimeType);
  return `${sourceKind}_recording_${Date.now()}.${extension}`;
};

const buildCameraLabel = (index: number): string => `Cámara ${index + 1}`;
const buildMicrophoneLabel = (index: number): string => `Micrófono ${index + 1}`;

const toRecordingDevices = (mediaDevices: MediaDeviceInfo[]): RecordingDevices => {
  const videoInputs = mediaDevices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      id: `camera:${device.deviceId || index}`,
      label: device.label || buildCameraLabel(index),
      kind: 'camera' as const,
      deviceId: device.deviceId || undefined,
    }));

  const audioInputs = mediaDevices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      id: device.deviceId || `audio:${index}`,
      label: device.label || buildMicrophoneLabel(index),
      deviceId: device.deviceId || undefined,
    }));

  return {
    video: [
      { id: SCREEN_SOURCE_ID, label: 'Compartir pantalla', kind: 'screen' as const },
      ...videoInputs,
    ],
    audio: audioInputs,
  };
};

const getSelectedVideoSource = (
  devices: RecordingDevices | null,
  sourceId: string,
): VideoSourceOption | null => {
  return devices?.video.find((device) => device.id === sourceId) ?? null;
};

const getSelectedAudioSource = (
  devices: RecordingDevices | null,
  audioId: string,
): AudioSourceOption | null => {
  return devices?.audio.find((device) => device.id === audioId) ?? null;
};

const buildAudioConstraints = (audioDevice: AudioSourceOption | null): MediaTrackConstraints | boolean => {
  const deviceId = audioDevice?.deviceId;
  if (deviceId && deviceId !== 'default') {
    return { deviceId: { exact: deviceId } };
  }
  return true;
};

const openCameraStream = async (deviceId?: string): Promise<MediaStream> => {
  let lastError: unknown = null;

  for (const profile of CAMERA_PROFILES) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: profile.width },
          height: { ideal: profile.height },
          frameRate: { ideal: CAPTURE_TARGET_FPS, max: CAPTURE_TARGET_FPS },
        },
        audio: false,
      });

      const actualFps = getTrackFrameRate(stream);
      if (actualFps === 0 || actualFps >= MIN_ACCEPTABLE_CAMERA_FPS) {
        return stream;
      }

      stopMediaStream(stream);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo abrir la cámara seleccionada');
};

const openScreenStream = async (): Promise<MediaStream> => {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: CAPTURE_TARGET_FPS, max: CAPTURE_TARGET_FPS },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
};

export const useRecording = (): UseRecordingReturn => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<RecordingDevices | null>(null);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState(SCREEN_SOURCE_ID);
  const [selectedAudioId, setSelectedAudioId] = useState('default');
  const [captureActive, setCaptureActive] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState<string | null>(null);
  const [captureFps, setCaptureFps] = useState(0);
  const [captureTargetFps, setCaptureTargetFps] = useState(CAPTURE_TARGET_FPS);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const selectedVideoSourceRef = useRef(selectedVideoSourceId);
  const selectedAudioIdRef = useRef(selectedAudioId);
  const captureBusyRef = useRef(false);
  const recordingMimeTypeRef = useRef('video/webm');
  const audioPermissionWarmupAttemptedRef = useRef(false);

  useEffect(() => {
    selectedVideoSourceRef.current = selectedVideoSourceId;
  }, [selectedVideoSourceId]);

  useEffect(() => {
    selectedAudioIdRef.current = selectedAudioId;
  }, [selectedAudioId]);

  useEffect(() => {
    captureBusyRef.current = captureBusy;
  }, [captureBusy]);

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('La enumeración de dispositivos multimedia no está disponible en este entorno');
    }

    let browserDevices = await navigator.mediaDevices.enumerateDevices();
    const hasAudioInputs = browserDevices.some((device) => device.kind === 'audioinput');
    const hasNamedAudioInput = browserDevices.some(
      (device) => device.kind === 'audioinput' && device.label.trim().length > 0,
    );

    if (hasAudioInputs && !hasNamedAudioInput && !audioPermissionWarmupAttemptedRef.current) {
      audioPermissionWarmupAttemptedRef.current = true;

      try {
        const permissionProbe = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        stopMediaStream(permissionProbe);
        browserDevices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        // If the user dismisses/denies the permission prompt we keep the fallback list.
      }
    }

    const nextDevices = toRecordingDevices(browserDevices);

    setDevices(nextDevices);
    setSelectedVideoSourceId((current) => {
      const exists = nextDevices.video.some((device) => device.id === current);
      return exists ? current : SCREEN_SOURCE_ID;
    });
    setSelectedAudioId((current) => {
      const exists = nextDevices.audio.some((device) => device.id === current);
      return exists ? current : (nextDevices.audio[0]?.id ?? 'default');
    });
  }, []);

  const releasePreview = useCallback((resetState = true) => {
    stopMediaStream(previewStreamRef.current);
    previewStreamRef.current = null;

    if (resetState) {
      setPreviewStream(null);
      setCaptureActive(false);
      setCaptureStartedAt(null);
      setCaptureFps(0);
      setCaptureTargetFps(CAPTURE_TARGET_FPS);
    }
  }, []);

  const releaseRecordingResources = useCallback(() => {
    stopMediaStream(recordingStreamRef.current);
    stopMediaStream(microphoneStreamRef.current);
    recordingStreamRef.current = null;
    microphoneStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
  }, []);

  const stopActiveRecording = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      throw new Error('No hay ninguna grabación en curso');
    }

    const source = getSelectedVideoSource(devices, selectedVideoSourceRef.current);
    const sourceKind = source?.kind ?? 'screen';

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const finalizeUpload = async () => {
        if (recordedChunksRef.current.length === 0) {
          throw new Error('La grabación terminó sin generar datos');
        }

        const mimeType = recordingMimeTypeRef.current || recorder.mimeType || 'video/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const file = new File(
          [blob],
          buildUploadedFilename(sourceKind, mimeType),
          { type: mimeType },
        );

        const result = await uploadRecording(file);
        settled = true;
        releaseRecordingResources();
        resolve(result.path);
      };

      const fail = (reason: unknown) => {
        if (settled) return;
        settled = true;
        releaseRecordingResources();
        reject(
          reason instanceof Error
            ? reason
            : new Error('No se pudo finalizar la grabación'),
        );
      };

      recorder.onerror = () => {
        fail(new Error('El grabador falló al detenerse'));
      };

      recorder.onstop = async () => {
        if (settled) return;

        try {
          await finalizeUpload();
        } catch (reason) {
          fail(reason);
        }
      };

      try {
        if (recorder.state === 'inactive') {
          void finalizeUpload().catch(fail);
          return;
        }

        recorder.requestData();
        recorder.stop();
      } catch (reason) {
        fail(reason);
      }
    });
  }, [devices, releaseRecordingResources]);

  const handleCaptureEnded = useCallback(async () => {
    if (captureBusyRef.current) return;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        setCaptureBusy(true);
        setRecording(false);
        const path = await stopActiveRecording();
        setRecordingPath(path);
        setError('La fuente de vídeo se cerró desde el sistema. Guardé la grabación hasta ese momento.');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'La fuente se cerró y no se pudo guardar la grabación');
      } finally {
        setCaptureBusy(false);
      }
    }

    releasePreview();
  }, [releasePreview, stopActiveRecording]);

  const activateCapture = useCallback(async (sourceId: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('La captura multimedia no está disponible en este entorno');
    }

    const source = getSelectedVideoSource(devices, sourceId);
    const nextStream = source?.kind === 'camera'
      ? await openCameraStream(source.deviceId)
      : await openScreenStream();

    releasePreview(false);

    const videoTrack = getVideoTrack(nextStream);
    if (!videoTrack) {
      stopMediaStream(nextStream);
      throw new Error('La fuente seleccionada no produjo ninguna pista de vídeo');
    }

    videoTrack.onended = () => {
      void handleCaptureEnded();
    };

    previewStreamRef.current = nextStream;
    setPreviewStream(nextStream);
    setCaptureActive(true);
    setCaptureStartedAt(new Date().toISOString());
    setCaptureFps(getTrackFrameRate(nextStream));
    setCaptureTargetFps(CAPTURE_TARGET_FPS);

    await loadDevices();
  }, [devices, handleCaptureEnded, loadDevices, releasePreview]);

  useEffect(() => {
    loadDevices().catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los dispositivos multimedia');
    });
  }, [loadDevices]);

  useEffect(() => {
    const handleDeviceChange = () => {
      void loadDevices().catch(() => {
        // Ignore transient device refresh errors
      });
    };

    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [loadDevices]);

  useEffect(() => {
    if (recording) {
      intervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [recording]);

  useEffect(() => {
    return () => {
      stopMediaStream(previewStreamRef.current);
      releaseRecordingResources();
    };
  }, [releaseRecordingResources]);

  const handleStart = useCallback(async () => {
    if (captureBusy || recording) return;

    if (typeof MediaRecorder === 'undefined') {
      setError('MediaRecorder no está disponible en este entorno');
      return;
    }

    const currentPreview = previewStreamRef.current;
    const previewTrack = getVideoTrack(currentPreview);
    if (!currentPreview || !previewTrack) {
      setError('Activa la vista previa antes de empezar a grabar');
      return;
    }

    try {
      setError(null);
      setCaptureBusy(true);

      const audioSource = getSelectedAudioSource(devices, selectedAudioIdRef.current);
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(audioSource),
        video: false,
      });

      const recordingStream = new MediaStream([
        previewTrack.clone(),
        ...microphoneStream.getAudioTracks(),
      ]);

      const mimeType = pickRecorderMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(recordingStream, {
            mimeType,
            videoBitsPerSecond: getSelectedVideoSource(devices, selectedVideoSourceRef.current)?.kind === 'screen'
              ? 8_000_000
              : 5_000_000,
            audioBitsPerSecond: 192_000,
          })
        : new MediaRecorder(recordingStream);

      microphoneStreamRef.current = microphoneStream;
      recordingStreamRef.current = recordingStream;
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      recordingMimeTypeRef.current = mediaRecorder.mimeType || mimeType || 'video/webm';

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        setError('La grabación falló mientras se capturaba el vídeo');
      };

      mediaRecorder.start(1000);
      setRecording(true);
      setElapsed(0);
    } catch (reason) {
      releaseRecordingResources();
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar la grabación');
    } finally {
      setCaptureBusy(false);
    }
  }, [captureBusy, devices, recording, releaseRecordingResources]);

  const handleStop = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current) {
      setError('No hay ninguna grabación en curso');
      return null;
    }

    try {
      setError(null);
      setCaptureBusy(true);
      setRecording(false);

      const path = await stopActiveRecording();
      setRecordingPath(path);
      return path;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo detener la grabación');
      return null;
    } finally {
      setCaptureBusy(false);
    }
  }, [stopActiveRecording]);

  const handleProcessRecording = useCallback(async () => {
    if (!recordingPath) {
      setError('No hay ninguna ruta de grabación disponible');
      return;
    }

    try {
      setError(null);
      await processMovFile(recordingPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo procesar la grabación');
    }
  }, [recordingPath]);

  const handleStartCapture = useCallback(async () => {
    if (captureBusy || recording) return;

    try {
      setError(null);
      setCaptureBusy(true);
      await activateCapture(selectedVideoSourceRef.current);
    } catch (reason) {
      releasePreview();
      setError(reason instanceof Error ? reason.message : 'No se pudo activar la captura');
    } finally {
      setCaptureBusy(false);
    }
  }, [activateCapture, captureBusy, recording, releasePreview]);

  const handleStopCapture = useCallback(async () => {
    if (captureBusy || recording) return;

    try {
      setError(null);
      setCaptureBusy(true);
      releasePreview();
    } finally {
      setCaptureBusy(false);
    }
  }, [captureBusy, recording, releasePreview]);

  const handleVideoSourceChange = useCallback(async (id: string) => {
    setSelectedVideoSourceId(id);

    if (!captureActive || captureBusy || recording) {
      return;
    }

    try {
      setError(null);
      setCaptureBusy(true);
      await activateCapture(id);
    } catch (reason) {
      releasePreview();
      setError(reason instanceof Error ? reason.message : 'No se pudo cambiar la fuente de vídeo');
    } finally {
      setCaptureBusy(false);
    }
  }, [activateCapture, captureActive, captureBusy, recording, releasePreview]);

  const handleAudioChange = useCallback((id: string) => {
    setSelectedAudioId(id);
  }, []);

  const selectedAudioDeviceId = getSelectedAudioSource(devices, selectedAudioId)?.deviceId ?? null;
  const audioLevelEnabled = (captureActive || recording) && (devices?.audio.length ?? 0) > 0;
  const { level: audioLevel, error: audioLevelError } = useAudioLevel(
    selectedAudioDeviceId,
    audioLevelEnabled,
    { onPermissionGranted: loadDevices },
  );

  return {
    recording,
    elapsed,
    error,
    devices,
    recordingPath,
    selectedVideoSourceId,
    selectedAudioId,
    audioLevel,
    audioLevelError,
    captureActive,
    captureBusy,
    captureStartedAt,
    captureFps,
    captureTargetFps,
    previewStream,
    handleVideoSourceChange,
    handleAudioChange,
    loadDevices,
    handleStart,
    handleStop,
    handleProcessRecording,
    handleStartCapture,
    handleStopCapture,
  };
};
