import type { FilterDefinition } from '../types/filter-types';
import type { Profile, Tag } from '../api/client';

export const buildMeetingFilterDefinitions = (
  profiles: Profile[],
  tags: Tag[],
): FilterDefinition[] => [
  {
    id: 'participant',
    label: 'Participante',
    type: 'select',
    options: profiles.map(p => ({ value: String(p.id), label: p.name })),
  },
  {
    id: 'tag',
    label: 'Tag',
    type: 'multi_select',
    options: tags.map(t => ({
      value: String(t.id),
      label: t.name,
      color: t.color,
    })),
  },
  {
    id: 'status',
    label: 'Estado',
    type: 'select',
    options: [
      { value: 'completed', label: 'Completed' },
      { value: 'pending', label: 'Pending' },
      { value: 'processing', label: 'Processing' },
      { value: 'error', label: 'Error' },
    ],
  },
  {
    id: 'language',
    label: 'Idioma',
    type: 'select',
    options: [
      { value: 'es', label: 'Espanol' },
      { value: 'en', label: 'English' },
    ],
  },
];
