import React from 'react';
import type { AppliedFilter, FilterDefinition } from '../../types/filter-types';

interface FilterChipProps {
  filter: AppliedFilter;
  definition: FilterDefinition;
  onRemove: () => void;
}

const getDisplayValues = (filter: AppliedFilter, definition: FilterDefinition): string => {
  return filter.values
    .map(v => definition.options?.find(o => o.value === v)?.label ?? v)
    .join(', ');
};

export const FilterChip: React.FC<FilterChipProps> = ({ filter, definition, onRemove }) => (
  <div className="filter-chip">
    <span className="filter-chip-label">{definition.label}:</span>
    <span>{getDisplayValues(filter, definition)}</span>
    <button
      className="filter-chip-remove"
      onClick={onRemove}
      title="Remove filter"
    >
      &times;
    </button>
  </div>
);
