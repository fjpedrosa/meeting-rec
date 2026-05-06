import React, { useState, useEffect, useMemo } from 'react';
import { Meeting, Profile, Tag, fetchMeetings, fetchProfiles, fetchTags, pickMovFile, processMovFile, archiveMeeting, retryMeeting, type MeetingFilters } from '../api/client';
import { MeetingList } from '../components/meeting-list';
import { RecordingControls } from '../components/recording-controls';
import { useRecording } from '../hooks/use-recording';
import { useProcessingProgress } from '../hooks/use-processing-progress';
import { ProcessingProgress } from '../components/processing-progress';
import { TagManager } from '../components/tag-manager';
import { FilterBar } from '../components/filters/filter-bar';
import { useFilters } from '../hooks/use-filters';
import { buildMeetingFilterDefinitions } from '../config/meeting-filter-config';
import type { AppliedFilter } from '../types/filter-types';

interface MeetingsPageProps {
  onNavigate: (hash: string) => void;
}

type ProcessStep = 'idle' | 'picking' | 'picked' | 'extracting' | 'processing' | 'done' | 'error';

const STEP_LABELS: Record<ProcessStep, string> = {
  idle: '',
  picking: 'Opening file picker...',
  picked: 'Ready to process',
  extracting: 'Extracting audio and starting transcription...',
  processing: 'Transcription in progress. This may take 10-15 minutes.',
  done: 'Processing started! The meeting will appear in the list when ready.',
  error: 'Error',
};

export const MeetingsPage: React.FC<MeetingsPageProps> = ({ onNavigate }) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    recording,
    elapsed,
    error: recordingError,
    screenAudioMessage,
    recordingProcessing,
    recordingProcessStarted,
    devices,
    recordingPath,
    selectedVideoSourceId,
    selectedAudioId,
    selectedSystemAudioId,
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
    handleSystemAudioChange,
    loadDevices,
    handleStart,
    handleStop,
    handleProcessRecording,
    handleStartCapture,
    handleStopCapture,
  } = useRecording();

  const [showProcessForm, setShowProcessForm] = useState(false);
  const [movPath, setMovPath] = useState('');
  const [language, setLanguage] = useState('');
  const [step, setStep] = useState<ProcessStep>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const { processings } = useProcessingProgress();

  // Filters
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [showTagManager, setShowTagManager] = useState(false);

  const filterDefinitions = useMemo(
    () => buildMeetingFilterDefinitions(profiles, tags),
    [profiles, tags],
  );
  const { appliedFilters, toggleFilterValue, removeFilter, clearAll, hasActiveFilters } = useFilters(filterDefinitions);

  const toApiFilters = (filters: AppliedFilter[]): MeetingFilters => {
    const result: MeetingFilters = {};
    const participant = filters.find(f => f.filterId === 'participant');
    const tag = filters.find(f => f.filterId === 'tag');
    const status = filters.find(f => f.filterId === 'status');
    if (participant?.values[0]) result.profileId = parseInt(participant.values[0], 10);
    if (tag?.values[0]) result.tagId = parseInt(tag.values[0], 10);
    if (status?.values[0]) result.status = status.values[0];
    return result;
  };

  const loadMeetings = async (filters?: MeetingFilters) => {
    try {
      const data = await fetchMeetings(filters);
      data.sort((a, b) =>
        new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime()
      );
      setMeetings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  const loadFilterOptions = async () => {
    try {
      const [profilesData, tagsData] = await Promise.all([fetchProfiles(), fetchTags()]);
      setProfiles(profilesData);
      setTags(tagsData);
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    setLoading(true);
    loadMeetings(toApiFilters(appliedFilters));
  }, [appliedFilters]);

  useEffect(() => {
    const completedOrError = processings.find(
      p => (p.step === 'complete' || p.step === 'error')
    );
    if (completedOrError) {
      loadMeetings(toApiFilters(appliedFilters));
      if (completedOrError.step === 'complete') {
        setStep('done');
      }
    }
  }, [processings]);

  const handlePickFile = async () => {
    setStep('picking');
    setErrorMsg('');
    try {
      const path = await pickMovFile();
      setMovPath(path);
      setStep('picked');
    } catch (err) {
      setStep('idle');
    }
  };

  const handleProcess = async () => {
    if (!movPath.trim()) return;
    setStep('extracting');
    setErrorMsg('');
    try {
      await processMovFile(movPath.trim(), language || undefined);
      setStep('processing');
    } catch (err) {
      setStep('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process');
    }
  };

  const handleReset = () => {
    setShowProcessForm(false);
    setMovPath('');
    setLanguage('');
    setStep('idle');
    setErrorMsg('');
  };

  const handleMeetingClick = (meeting: Meeting) => {
    onNavigate(`#/meetings/${meeting.id}`);
  };

  const handleArchive = async (meeting: Meeting) => {
    try {
      await archiveMeeting(meeting.id);
      setMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive');
    }
  };

  const handleRetry = async (meeting: Meeting) => {
    try {
      await retryMeeting(meeting.id);
      loadMeetings(toApiFilters(appliedFilters));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        Loading meetings...
      </div>
    );
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  const isProcessing = step === 'extracting' || step === 'processing';
  const fileName = movPath ? movPath.split('/').pop() : '';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Meetings</h1>
          <p className="page-subtitle">{meetings.length} meetings recorded</p>
        </div>
        {!showProcessForm && (
          <button className="btn btn-primary" onClick={() => { setShowProcessForm(true); setStep('idle'); }}>
            + Process Recording
          </button>
        )}
      </div>

      <RecordingControls
        recording={recording}
        elapsed={elapsed}
        error={recordingError}
        screenAudioMessage={screenAudioMessage}
        recordingProcessing={recordingProcessing}
        recordingProcessStarted={recordingProcessStarted}
        devices={devices}
        selectedVideoSourceId={selectedVideoSourceId}
        selectedAudioId={selectedAudioId}
        selectedSystemAudioId={selectedSystemAudioId}
        audioLevel={audioLevel}
        audioLevelError={audioLevelError}
        captureActive={captureActive}
        captureBusy={captureBusy}
        captureStartedAt={captureStartedAt}
        captureFps={captureFps}
        captureTargetFps={captureTargetFps}
        previewStream={previewStream}
        onVideoSourceChange={handleVideoSourceChange}
        onAudioChange={handleAudioChange}
        onSystemAudioChange={handleSystemAudioChange}
        onStart={handleStart}
        onStop={handleStop}
        onProcess={handleProcessRecording}
        onLoadDevices={loadDevices}
        onStartCapture={handleStartCapture}
        onStopCapture={handleStopCapture}
        recordingPath={recordingPath}
      />

      {showProcessForm && (
        <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0' }}>Process a recording</h3>

          {/* File selection */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={handlePickFile}
              disabled={isProcessing || step === 'picking'}
              style={{ minWidth: '180px' }}
            >
              {step === 'picking' ? 'Opening...' : fileName || 'Choose .mov file'}
            </button>

            <select
              className="form-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isProcessing}
              style={{ width: '130px' }}
            >
              <option value="">Auto-detect</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>

            <button
              className="btn btn-primary"
              onClick={handleProcess}
              disabled={!movPath.trim() || isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Process'}
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleReset}
              disabled={step === 'picking'}
            >
              {isProcessing ? 'Close' : 'Cancel'}
            </button>
          </div>

          {/* File path */}
          {movPath && step !== 'idle' && (
            <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>{movPath}</p>
          )}

          {/* Progress indicator */}
          {processings.length > 0 && (step === 'extracting' || step === 'processing') && (
            <div style={{ marginTop: '16px' }}>
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

          {/* Done/Error states (when no active processing) */}
          {(step === 'done' || step === 'error') && processings.length === 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px',
                borderRadius: '6px',
                background: step === 'error' ? '#fef2f2' : '#f0fdf4',
                color: step === 'error' ? 'var(--error)' : 'var(--success)',
              }}>
                {step === 'done' && <span>&#10003;</span>}
                {step === 'error' && <span>&#10007;</span>}
                <span>{step === 'error' ? errorMsg : STEP_LABELS[step]}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter bar */}
      <FilterBar
        definitions={filterDefinitions}
        appliedFilters={appliedFilters}
        onToggleValue={toggleFilterValue}
        onRemoveFilter={removeFilter}
        onClearAll={clearAll}
        hasActiveFilters={hasActiveFilters}
        onManageTags={() => setShowTagManager(true)}
      />

      <MeetingList
        meetings={meetings}
        onMeetingClick={handleMeetingClick}
        onArchive={handleArchive}
        onRetry={handleRetry}
      />

      {showTagManager && (
        <TagManager
          onClose={() => { setShowTagManager(false); loadFilterOptions(); }}
        />
      )}
    </div>
  );
};
