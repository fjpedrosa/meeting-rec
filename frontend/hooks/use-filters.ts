import { useState, useCallback, useMemo } from 'react';
import type { FilterDefinition, AppliedFilter } from '../types/filter-types';

export const useFilters = (definitions: FilterDefinition[]) => {
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilter[]>([]);

  const toggleFilterValue = useCallback((filterId: string, value: string) => {
    const def = definitions.find(d => d.id === filterId);
    if (!def) return;

    setAppliedFilters(prev => {
      const existing = prev.find(f => f.filterId === filterId);

      if (def.type === 'multi_select') {
        if (!existing) {
          return [...prev, { filterId, values: [value] }];
        }
        const hasValue = existing.values.includes(value);
        const newValues = hasValue
          ? existing.values.filter(v => v !== value)
          : [...existing.values, value];
        if (newValues.length === 0) {
          return prev.filter(f => f.filterId !== filterId);
        }
        return prev.map(f => f.filterId === filterId ? { ...f, values: newValues } : f);
      }

      // select: toggle off if same value, otherwise set
      if (existing?.values[0] === value) {
        return prev.filter(f => f.filterId !== filterId);
      }
      if (existing) {
        return prev.map(f => f.filterId === filterId ? { ...f, values: [value] } : f);
      }
      return [...prev, { filterId, values: [value] }];
    });
  }, [definitions]);

  const removeFilter = useCallback((filterId: string) => {
    setAppliedFilters(prev => prev.filter(f => f.filterId !== filterId));
  }, []);

  const clearAll = useCallback(() => {
    setAppliedFilters([]);
  }, []);

  const hasActiveFilters = useMemo(() => appliedFilters.length > 0, [appliedFilters]);

  return { appliedFilters, toggleFilterValue, removeFilter, clearAll, hasActiveFilters };
};
