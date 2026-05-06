import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RecordingDevices } from '../types/recording';
import { AudioLevelBar } from './audio-level-bar';

interface RecordingControlsProps {
  recording: boolean;
  elapsed: number;
  error: string | null;
  screenAudioMessage: string | null;
  devices: RecordingDevices | null;
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
  onVideoSourceChange: (id: string) => void;
  onAudioChange: (id: string) => void;
  onStart: () => void;
  onStop: () => void;
  onProcess: () => void;
  onLoadDevices: () => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  recordingPath: string | null;
}

const formatElapsed = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  recording,
  elapsed,
  error,
  screenAudioMessage,
  devices,
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
  onVideoSourceChange,
  onAudioChange,
  onStart,
  onStop,
  onProcess,
  onLoadDevices,
  onStartCapture,
  onStopCapture,
  recordingPath,
}) => {
  const showProcessButton = !recording && recordingPath;
  const [hasFrame, setHasFrame] = useState(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const selectedVideoSource = useMemo(
    () => devices?.video.find((device) => device.id === selectedVideoSourceId) ?? null,
    [devices, selectedVideoSourceId],
  );

  useEffect(() => {
    setHasFrame(false);
  }, [previewStream, captureStartedAt]);

  useEffect(() => {
    const video = previewRef.current;
    if (!video) return;

    video.srcObject = previewStream;

    if (previewStream) {
      void video.play().catch(() => {
        // The user action already triggered capture; ignore autoplay races.
      });
    } else {
      video.pause();
    }

    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [previewStream]);

  const selectsDisabled = recording || captureBusy;

  return (
    <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
      <h3 style={{ margin: '0 0 16px 0' }}>Grabar reunión</h3>

      {error && (
        <div className="error" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div className="recording-controls-row" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>
            Fuente de vídeo
          </label>
          <select
            className="form-select recording-device-select"
            value={selectedVideoSourceId}
            onChange={(e) => onVideoSourceChange(e.target.value)}
            disabled={selectsDisabled}
          >
            {devices?.video && devices.video.length > 0 ? (
              devices.video.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))
            ) : (
              <option value={selectedVideoSourceId}>Compartir pantalla</option>
            )}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>
            Fuente de audio
          </label>
          <select
            className="form-select recording-device-select"
            value={selectedAudioId}
            onChange={(e) => onAudioChange(e.target.value)}
            disabled={selectsDisabled}
          >
            {devices?.audio && devices.audio.length > 0 ? (
              devices.audio.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))
            ) : (
              <option value={selectedAudioId}>Micrófono por defecto</option>
            )}
          </select>
        </div>

        {!captureActive && !recording && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onLoadDevices} disabled={captureBusy}>
              Actualizar dispositivos
            </button>
          </div>
        )}
      </div>

      {recording && (
        <div className="recording-indicator" style={{ marginBottom: '12px' }}>
          <span className="recording-dot" />
          <span className="recording-timer">{formatElapsed(elapsed)}</span>
        </div>
      )}

      {captureActive && (
        <div style={{ marginBottom: '16px' }}>
          <div className="recording-live-panel">
            <div className="recording-preview-container" style={{ width: 'min(100%, 420px)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <span>
                  Vista previa
                  {selectedVideoSource?.kind === 'screen' ? ' · Pantalla' : ' · Cámara'}
                </span>
                <span>{captureFps.toFixed(1)} fps / {captureTargetFps} fps</span>
              </div>

              {!hasFrame && (
                <div
                  className="recording-preview-fallback"
                  style={{
                    minHeight: '220px',
                    position: 'relative',
                  }}
                >
                  Esperando el primer frame…
                </div>
              )}

              <video
                ref={previewRef}
                muted
                playsInline
                autoPlay
                onLoadedData={() => setHasFrame(true)}
                onCanPlay={() => setHasFrame(true)}
                onEmptied={() => setHasFrame(false)}
                className="recording-preview-img"
                style={{ display: hasFrame ? 'block' : 'none', width: '100%', height: 'auto' }}
              />
            </div>

            <div className="recording-audio-panel">
              <span className="recording-audio-label">Audio seleccionado</span>
              <div className="recording-audio-meter">
                <AudioLevelBar level={audioLevel} />
              </div>
              <span className="recording-audio-value">{Math.round(audioLevel)}%</span>
              <p
                style={{
                  margin: 0,
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                }}
              >
                {audioLevelError
                  ? `Sin señal: ${audioLevelError}`
                  : 'El sonómetro usa la fuente de audio seleccionada arriba.'}
              </p>
              {screenAudioMessage && (
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    color: screenAudioMessage.startsWith('No se recibió')
                      ? 'var(--warning, #f59e0b)'
                      : 'var(--success, #10b981)',
                    lineHeight: 1.5,
                  }}
                >
                  {screenAudioMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="recording-controls-row" style={{ gap: '8px' }}>
        {recording ? (
          <button className="btn btn-secondary" onClick={onStop} disabled={captureBusy}>
            {captureBusy ? 'Guardando grabación…' : 'Detener grabación'}
          </button>
        ) : captureActive ? (
          <>
            <button
              className="btn btn-primary"
              onClick={onStart}
              disabled={captureBusy}
              style={{ backgroundColor: 'var(--error)', borderColor: 'var(--error)' }}
            >
              Empezar grabación
            </button>
            <button className="btn btn-secondary" onClick={onStopCapture} disabled={captureBusy}>
              {captureBusy ? 'Actualizando captura…' : 'Desactivar captura'}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onStartCapture} disabled={captureBusy}>
            {captureBusy ? 'Actualizando captura…' : selectedVideoSource?.kind === 'screen' ? 'Elegir pantalla' : 'Activar cámara'}
          </button>
        )}
      </div>

      {showProcessButton && (
        <div style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Grabación guardada: {recordingPath}
          </p>
          <button className="btn btn-primary" onClick={onProcess}>
            Procesar grabación
          </button>
        </div>
      )}
    </div>
  );
};
