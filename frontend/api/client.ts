// API client for meeting transcription system
// All functions are pure - no classes

import type { RecordingDevices } from '../types/recording';

const API_BASE = '/api';

// Types
export interface Meeting {
  id: number;
  folder_name: string;
  mp3_path: string;
  transcript_path: string;
  language: string;
  meeting_date: string;
  processed_at: string;
  duration_seconds: number;
  status: string;
  error_message: string | null;
  title: string | null;
  tags?: MeetingTag[];
}

export interface MeetingParticipant {
  id: number;
  speakerLabel: string;
  profileId: number | null;
  isIdentified: boolean;
  profileName: string | null;
  clipPath: string | null;
}

export interface MeetingTag {
  id: number;
  name: string;
  color: string;
}

export interface Tag extends MeetingTag {
  createdAt: string;
  meetingCount: number;
}

export interface MeetingDetail extends Meeting {
  tags: MeetingTag[];
  participants: MeetingParticipant[];
}

export interface Profile {
  id: number;
  name: string;
  createdAt: string;
  notes: string | null;
  embeddingCount: number;
  sampleCount: number;
  meetingCount: number;
  confidence: number;
}

export interface ProfileDetail extends Profile {
  meetings: Array<{
    meetingId: number;
    folderName: string;
    meetingDate: string;
    speakerLabel: string;
  }>;
}

export interface ProfileSample {
  id: number;
  clipPath: string;
  speakerLabel: string;
  folderName: string;
  meetingDate: string | null;
  source: 'unknown' | 'identified';
}

export interface UnknownSpeaker {
  id: number;
  meetingId: number;
  speakerLabel: string;
  clipPath: string | null;
  status: string;
  meeting: {
    folderName: string;
    meetingDate: string | null;
  };
}

export interface StructuredTranscriptWord {
  text: string;
  raw_text: string;
  start: number;
  end: number;
  speaker_label: string;
  speaker_display_name: string;
  speaker_confidence: number | null;
  has_overlap: boolean;
}

export interface StructuredTranscriptSegment {
  start: number;
  end: number;
  speaker_label: string;
  speaker_display_name: string;
  speaker_confidence: number | null;
  has_overlap: boolean;
  text: string;
  words: StructuredTranscriptWord[];
}

export interface PipelineMetadata {
  transcription_model: string;
  diarization_model: string;
  diarization_device: string;
  embedding_model: string;
  identification: {
    match_score_threshold: number;
    best_exemplar_distance_threshold: number;
    min_quality_score: number;
    confidence_margin: number;
  };
  segmentation: {
    min_word_overlap_ratio: number;
    overlap_word_ratio: number;
    max_word_gap_to_merge: number;
  };
  processed_at: string;
}

export interface StructuredTranscript {
  version: number;
  language: string | null;
  duration_seconds: number | null;
  speakers: Record<string, { profile_id: number | null; display_name: string }>;
  segments: StructuredTranscriptSegment[];
  pipeline?: PipelineMetadata;
}

// Unwrap API response: { success, data, error }
const unwrap = async <T>(response: Response, errorMsg: string): Promise<T> => {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || errorMsg);
  }
  const body = await response.json();
  if (!body.success) throw new Error(body.error || errorMsg);
  return body.data as T;
};

// API functions
export interface MeetingFilters {
  profileId?: number;
  tagId?: number;
  status?: string;
}

export const fetchMeetings = async (filters?: MeetingFilters): Promise<Meeting[]> => {
  const params = new URLSearchParams();
  if (filters?.profileId) params.set('profile_id', String(filters.profileId));
  if (filters?.tagId) params.set('tag_id', String(filters.tagId));
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  const response = await fetch(`${API_BASE}/meetings${qs ? `?${qs}` : ''}`);
  return unwrap<Meeting[]>(response, 'Failed to fetch meetings');
};

export const fetchMeeting = async (id: number): Promise<MeetingDetail> => {
  const response = await fetch(`${API_BASE}/meetings/${id}`);
  return unwrap<MeetingDetail>(response, 'Failed to fetch meeting');
};

export const updateMeeting = async (id: number, data: { title?: string }): Promise<Meeting> => {
  const response = await fetch(`${API_BASE}/meetings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return unwrap<Meeting>(response, 'Failed to update meeting');
};

export const archiveMeeting = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/meetings/${id}`, { method: 'DELETE' });
  await unwrap(response, 'Failed to archive meeting');
};

export const retryMeeting = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/meetings/${id}/retry`, { method: 'POST' });
  await unwrap(response, 'Failed to retry meeting');
};

export const rediarizeMeeting = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/meetings/${id}/rediarize`, { method: 'POST' });
  await unwrap(response, 'Failed to start re-diarization');
};

// Tag API functions
export const fetchTags = async (): Promise<Tag[]> => {
  const response = await fetch(`${API_BASE}/tags`);
  return unwrap<Tag[]>(response, 'Failed to fetch tags');
};

export const createTag = async (name: string, color?: string): Promise<Tag> => {
  const response = await fetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  return unwrap<Tag>(response, 'Failed to create tag');
};

export const updateTag = async (id: number, data: { name?: string; color?: string }): Promise<Tag> => {
  const response = await fetch(`${API_BASE}/tags/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return unwrap<Tag>(response, 'Failed to update tag');
};

export const deleteTag = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/tags/${id}`, { method: 'DELETE' });
  await unwrap(response, 'Failed to delete tag');
};

export const assignTagToMeeting = async (meetingId: number, tagId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/meetings/${meetingId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagId }),
  });
  await unwrap(response, 'Failed to assign tag');
};

export const removeTagFromMeeting = async (meetingId: number, tagId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/meetings/${meetingId}/tags/${tagId}`, { method: 'DELETE' });
  await unwrap(response, 'Failed to remove tag');
};

export const fetchTranscription = async (id: number): Promise<string> => {
  const response = await fetch(`${API_BASE}/meetings/${id}/transcription`);
  const data = await unwrap<{ content: string }>(response, 'Failed to fetch transcription');
  return data.content;
};

export const fetchStructuredTranscription = async (id: number): Promise<StructuredTranscript> => {
  const response = await fetch(`${API_BASE}/meetings/${id}/transcription-structured`);
  const data = await unwrap<{ content: StructuredTranscript }>(response, 'Failed to fetch structured transcription');
  return data.content;
};

export const fetchProfiles = async (): Promise<Profile[]> => {
  const response = await fetch(`${API_BASE}/profiles`);
  return unwrap<Profile[]>(response, 'Failed to fetch profiles');
};

export const fetchProfile = async (id: number): Promise<ProfileDetail> => {
  const response = await fetch(`${API_BASE}/profiles/${id}`);
  return unwrap<ProfileDetail>(response, 'Failed to fetch profile');
};

export const createProfile = async (name: string, notes?: string): Promise<Profile> => {
  const response = await fetch(`${API_BASE}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, notes }),
  });
  return unwrap<Profile>(response, 'Failed to create profile');
};

export const updateProfile = async (id: number, data: { name: string }): Promise<Profile> => {
  const response = await fetch(`${API_BASE}/profiles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return unwrap<Profile>(response, 'Failed to update profile');
};

export const fetchProfileSamples = async (profileId: number): Promise<ProfileSample[]> => {
  const response = await fetch(`${API_BASE}/profiles/${profileId}/samples`);
  return unwrap<ProfileSample[]>(response, 'Failed to fetch profile samples');
};

export const deleteProfile = async (profileId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/profiles/${profileId}`, { method: 'DELETE' });
  await unwrap(response, 'Failed to delete profile');
};

export const reassignSample = async (sampleId: number, profileId: number, source: 'unknown' | 'identified'): Promise<void> => {
  const response = await fetch(`${API_BASE}/profiles/samples/${sampleId}/reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, source }),
  });
  await unwrap(response, 'Failed to reassign sample');
};

export const fetchUnknownSpeakers = async (): Promise<UnknownSpeaker[]> => {
  const response = await fetch(`${API_BASE}/unknown-speakers`);
  return unwrap<UnknownSpeaker[]>(response, 'Failed to fetch unknown speakers');
};

export const pickMovFile = async (): Promise<string> => {
  const response = await fetch(`${API_BASE}/process/pick-file`);
  const data = await unwrap<{ path: string }>(response, 'No file selected');
  return data.path;
};

export const processMovFile = async (movPath: string, language?: string): Promise<{ message: string }> => {
  const response = await fetch(`${API_BASE}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ movPath, language }),
  });
  return unwrap<{ message: string }>(response, 'Failed to start processing');
};

export const discardSpeaker = async (speakerId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/unknown-speakers/${speakerId}/discard`, {
    method: 'POST',
  });
  await unwrap(response, 'Failed to discard speaker');
};

export const assignSpeakerToProfile = async (speakerId: number, profileId: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/unknown-speakers/${speakerId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId }),
  });
  await unwrap(response, 'Failed to assign speaker to profile');
};

export const createProfileFromSpeaker = async (speakerId: number, name: string): Promise<Profile> => {
  const response = await fetch(`${API_BASE}/unknown-speakers/${speakerId}/create-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return unwrap<Profile>(response, 'Failed to create profile from speaker');
};

export const getClipUrl = (clipPath: string): string => {
  return `${API_BASE}/clips/${clipPath}`;
};

// Utility functions
export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export interface RecordingStatus {
  recording: boolean;
  path?: string;
  startedAt?: string;
  elapsed?: number;
}

export interface CaptureStatus {
  active: boolean;
  screenIndex: number | null;
  startedAt: string | null;
  hasFrame: boolean;
  currentFps: number;
  targetFps: number;
}

// Recording API functions
export const fetchRecordingDevices = async (): Promise<RecordingDevices> => {
  const response = await fetch(`${API_BASE}/record/devices`);
  return unwrap<RecordingDevices>(response, 'Failed to fetch devices');
};

export const uploadRecording = async (file: File): Promise<{ path: string }> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/record/upload`, {
    method: 'POST',
    body: formData,
  });

  return unwrap<{ path: string }>(response, 'Failed to upload recording');
};

export const startRecording = async (screenIndex?: number, audioIndex?: number, filename?: string): Promise<{ path: string; startedAt: string }> => {
  const response = await fetch(`${API_BASE}/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screenIndex, audioIndex, filename }),
  });
  return unwrap<{ path: string; startedAt: string }>(response, 'Failed to start recording');
};

export const stopRecording = async (): Promise<{ path: string; duration: number; stoppedAt: string }> => {
  const response = await fetch(`${API_BASE}/record/stop`, { method: 'POST' });
  return unwrap<{ path: string; duration: number; stoppedAt: string }>(response, 'Failed to stop recording');
};

export const fetchRecordingStatus = async (): Promise<RecordingStatus> => {
  const response = await fetch(`${API_BASE}/record/status`);
  return unwrap<RecordingStatus>(response, 'Failed to fetch recording status');
};

// Capture API (persistent preview)
export const startCapture = async (screenIndex?: number): Promise<{ screenIndex: number; startedAt: string }> => {
  const response = await fetch(`${API_BASE}/record/capture/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screenIndex }),
  });
  return unwrap<{ screenIndex: number; startedAt: string }>(response, 'Failed to start capture');
};

export const stopCapture = async (): Promise<void> => {
  const response = await fetch(`${API_BASE}/record/capture/stop`, { method: 'POST' });
  await unwrap(response, 'Failed to stop capture');
};

export const fetchCaptureStatus = async (): Promise<CaptureStatus> => {
  const response = await fetch(`${API_BASE}/record/capture/status`);
  return unwrap<CaptureStatus>(response, 'Failed to fetch capture status');
};

export const getCaptureFrameUrl = (): string => `${API_BASE}/record/capture/frame`;
export const getCaptureStreamUrl = (token?: string | null): string => {
  const suffix = token ? `?t=${encodeURIComponent(token)}` : '';
  return `${API_BASE}/record/capture/stream${suffix}`;
};
