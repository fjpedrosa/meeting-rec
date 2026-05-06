import React from 'react';
import { Meeting, formatDate, formatDuration } from '../api/client';

interface MeetingListProps {
  meetings: Meeting[];
  onMeetingClick: (meeting: Meeting) => void;
  onArchive: (meeting: Meeting) => void;
  onRetry: (meeting: Meeting) => void;
}

const getStatusClass = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'status-completed';
    case 'pending':
      return 'status-pending';
    case 'processing':
      return 'status-processing';
    case 'error':
      return 'status-error';
    default:
      return '';
  }
};

export const MeetingList: React.FC<MeetingListProps> = ({ meetings, onMeetingClick, onArchive, onRetry }) => {
  if (meetings.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No meetings found</div>
        <p>Meetings will appear here once they are processed.</p>
      </div>
    );
  }

  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Duration</th>
            <th>Language</th>
            <th>Status</th>
            <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((meeting) => (
            <tr key={meeting.id}>
              <td onClick={() => onMeetingClick(meeting)} style={{ cursor: 'pointer' }}>
                {formatDate(meeting.meeting_date)}
              </td>
              <td onClick={() => onMeetingClick(meeting)} style={{ cursor: 'pointer' }}>
                <div>
                  {meeting.title || meeting.folder_name}
                  {meeting.tags && meeting.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                      {meeting.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="tag-badge tag-badge-sm"
                          style={{ backgroundColor: tag.color + '20', color: tag.color, borderColor: tag.color + '40' }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </td>
              <td onClick={() => onMeetingClick(meeting)} className="font-mono" style={{ cursor: 'pointer' }}>
                {formatDuration(meeting.duration_seconds)}
              </td>
              <td onClick={() => onMeetingClick(meeting)} style={{ cursor: 'pointer' }}>
                {meeting.language.toUpperCase()}
              </td>
              <td onClick={() => onMeetingClick(meeting)} style={{ cursor: 'pointer' }}>
                <span
                  className={`status ${getStatusClass(meeting.status)}`}
                  title={meeting.status === 'error' && meeting.error_message ? meeting.error_message : undefined}
                >
                  {meeting.status}
                </span>
              </td>
              <td>
                <div className="meeting-actions">
                  {meeting.status === 'error' && (
                    <button
                      className="btn-icon"
                      title="Retry processing"
                      onClick={(e) => { e.stopPropagation(); onRetry(meeting); }}
                    >
                      ↻
                    </button>
                  )}
                  <button
                    className="btn-icon btn-icon-danger"
                    title="Archive meeting"
                    onClick={(e) => { e.stopPropagation(); onArchive(meeting); }}
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
