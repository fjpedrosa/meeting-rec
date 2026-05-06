import React from 'react';
import type { FilterDefinition } from '../../types/filter-types';

interface FilterValueSelectorProps {
  definition: FilterDefinition;
  selectedValues: string[];
  onToggleValue: (value: string) => void;
  onBack: () => void;
}

const ChevronLeft: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const FilterValueSelector: React.FC<FilterValueSelectorProps> = ({
  definition,
  selectedValues,
  onToggleValue,
  onBack,
}) => {
  const isMulti = definition.type === 'multi_select';
  const options = definition.options ?? [];

  if (options.length === 0) {
    return (
      <>
        <button className="filter-back-button" onClick={onBack}>
          <ChevronLeft />
          <span>{definition.label}</span>
        </button>
        <div className="filter-empty">No hay opciones</div>
      </>
    );
  }

  return (
    <>
      <button className="filter-back-button" onClick={onBack}>
        <ChevronLeft />
        <span>{definition.label}</span>
      </button>
      {options.map(option => {
        const isSelected = selectedValues.includes(option.value);
        const indicatorClass = isMulti
          ? `filter-indicator filter-indicator--checkbox${isSelected ? ' checked' : ''}`
          : `filter-indicator filter-indicator--radio${isSelected ? ' checked' : ''}`;

        return (
          <button
            key={option.value}
            className="filter-value-item"
            onClick={() => onToggleValue(option.value)}
          >
            <span className={indicatorClass} />
            {option.color && (
              <span className="filter-color-dot" style={{ backgroundColor: option.color }} />
            )}
            <span>{option.label}</span>
          </button>
        );
      })}
    </>
  );
};
