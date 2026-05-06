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
