export type VideoSourceKind = 'camera' | 'screen';

export interface VideoSourceOption {
  id: string;
  label: string;
  kind: VideoSourceKind;
  deviceId?: string;
}

export interface AudioSourceOption {
  id: string;
  label: string;
  deviceId?: string;
}

export interface RecordingDevices {
  video: VideoSourceOption[];
  audio: AudioSourceOption[];
}
