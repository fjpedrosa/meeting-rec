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
