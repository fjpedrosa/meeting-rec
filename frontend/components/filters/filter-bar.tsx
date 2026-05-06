import React from 'react';
import type { FilterDefinition, AppliedFilter } from '../../types/filter-types';
import { FilterAddButton } from './filter-add-button';
import { FilterChip } from './filter-chip';

interface FilterBarProps {
  definitions: FilterDefinition[];
  appliedFilters: AppliedFilter[];
  onToggleValue: (filterId: string, value: string) => void;
  onRemoveFilter: (filterId: string) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  onManageTags: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  definitions,
  appliedFilters,
  onToggleValue,
  onRemoveFilter,
  onClearAll,
  hasActiveFilters,
  onManageTags,
}) => (
  <div className="filter-bar">
    <FilterAddButton
      definitions={definitions}
      appliedFilters={appliedFilters}
      onToggleValue={onToggleValue}
    />

    {appliedFilters.map(filter => {
      const def = definitions.find(d => d.id === filter.filterId);
      if (!def) return null;
      return (
        <FilterChip
          key={filter.filterId}
          filter={filter}
          definition={def}
          onRemove={() => onRemoveFilter(filter.filterId)}
        />
      );
    })}

    {hasActiveFilters && (
      <button
        className="btn btn-secondary"
        style={{ fontSize: '12px', padding: '4px 10px' }}
        onClick={onClearAll}
      >
        Clear filters
      </button>
    )}

    <button
      className="btn btn-secondary"
      style={{ fontSize: '12px', padding: '4px 10px', marginLeft: 'auto' }}
      onClick={onManageTags}
    >
      Manage tags
    </button>
  </div>
);
