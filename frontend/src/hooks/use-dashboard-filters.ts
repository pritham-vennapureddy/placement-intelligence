import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { DashboardFilters } from "../types/api";

const FILTER_KEYS = ["from", "to", "productId", "skill"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const isValid: Record<FilterKey, (value: string) => boolean> = {
  from: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  to: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  productId: (value) => /^[0-9a-f-]{36}$/i.test(value),
  skill: (value) => value.length > 0 && value.length <= 80,
};

/** Dashboard filters kept in the URL, so filtered views can be shared and bookmarked. */
export function useDashboardFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const result: DashboardFilters = {};
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value && isValid[key](value)) {
        result[key] = value;
      }
    }
    return result;
  }, [params]);

  const setFilter = useCallback(
    (key: FilterKey, value: string | null) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  const clearFilters = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      FILTER_KEYS.forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  }, [setParams]);

  return { filters, setFilter, clearFilters, hasFilters: Object.keys(filters).length > 0 };
}
