export type FilterType = 'select' | 'multi_select' | 'text' | 'number' | 'date';

export interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

export interface FilterDefinition {
  id: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  placeholder?: string;
}

export interface AppliedFilter {
  filterId: string;
  values: string[];
}
