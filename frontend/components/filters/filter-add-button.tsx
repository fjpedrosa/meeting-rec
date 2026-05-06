import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FilterDefinition, AppliedFilter } from '../../types/filter-types';
import { FilterValueSelector } from './filter-value-selector';

interface FilterAddButtonProps {
  definitions: FilterDefinition[];
  appliedFilters: AppliedFilter[];
  onToggleValue: (filterId: string, value: string) => void;
}

const ChevronRight: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const FilterAddButton: React.FC<FilterAddButtonProps> = ({
  definitions,
  appliedFilters,
  onToggleValue,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [level, setLevel] = useState<0 | 1>(0);
  const [selectedDef, setSelectedDef] = useState<FilterDefinition | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const panel0Ref = useRef<HTMLDivElement>(null);
  const panel1Ref = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Available filters: hide select filters that already have a value applied
  const availableDefinitions = definitions.filter(def => {
    if (def.type === 'multi_select') return true;
    return !appliedFilters.some(f => f.filterId === def.id);
  });

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Reset to level 0 when opening
  const handleToggle = useCallback(() => {
    setIsOpen(prev => {
      if (!prev) {
        setLevel(0);
        setSelectedDef(null);
      }
      return !prev;
    });
  }, []);

  // Adapt viewport height to active panel
  useEffect(() => {
    if (!isOpen || !viewportRef.current) return;
    const activePanel = level === 0 ? panel0Ref.current : panel1Ref.current;
    if (activePanel) {
      viewportRef.current.style.height = `${activePanel.scrollHeight}px`;
    }
  }, [isOpen, level, selectedDef, appliedFilters]);

  const handleSelectCategory = (def: FilterDefinition) => {
    setSelectedDef(def);
    setLevel(1);
  };

  const handleBack = () => {
    setLevel(0);
  };

  const handleToggleValue = (value: string) => {
    if (!selectedDef) return;
    onToggleValue(selectedDef.id, value);

    // For single select, close after selection
    if (selectedDef.type !== 'multi_select') {
      setIsOpen(false);
    }
  };

  const selectedValues = selectedDef
    ? (appliedFilters.find(f => f.filterId === selectedDef.id)?.values ?? [])
    : [];

  return (
    <div className="filter-add-wrapper" ref={wrapperRef}>
      <button
        className="btn btn-secondary"
        style={{ fontSize: '12px', padding: '4px 10px' }}
        onClick={handleToggle}
      >
        + Filtro
      </button>

      {isOpen && (
        <div className="filter-dropdown">
          <div className="filter-dropdown-viewport" ref={viewportRef}>
            <div
              className="filter-dropdown-slider"
              style={{ transform: level === 0 ? 'translateX(0)' : 'translateX(-100%)' }}
            >
              {/* Level 0: Category list */}
              <div className="filter-dropdown-panel" ref={panel0Ref}>
                {availableDefinitions.length === 0 ? (
                  <div className="filter-empty">Todos los filtros aplicados</div>
                ) : (
                  availableDefinitions.map(def => (
                    <button
                      key={def.id}
                      className="filter-category-item"
                      onClick={() => handleSelectCategory(def)}
                    >
                      <span>{def.label}</span>
                      <ChevronRight />
                    </button>
                  ))
                )}
              </div>

              {/* Level 1: Value selector */}
              <div className="filter-dropdown-panel" ref={panel1Ref}>
                {selectedDef && (
                  <FilterValueSelector
                    definition={selectedDef}
                    selectedValues={selectedValues}
                    onToggleValue={handleToggleValue}
                    onBack={handleBack}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
