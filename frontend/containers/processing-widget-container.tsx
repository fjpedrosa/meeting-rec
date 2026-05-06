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
