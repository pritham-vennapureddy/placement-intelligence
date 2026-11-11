import { useQuery } from "@tanstack/react-query";
import { forwardRef, useId } from "react";
import { Input } from "../../components/ui/input";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { companiesApi } from "../../services/api";

/**
 * Free-text company name with suggestions from companies already used on
 * other jobs, so the same company is not typed two different ways. A new
 * name simply creates the company when the job is saved.
 */
export const CompanyNameInput = forwardRef<HTMLInputElement, {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
}>(function CompanyNameInput({ id, value, onChange, onBlur, invalid }, ref) {
  const listId = useId();
  const search = useDebouncedValue(value.trim(), 250);
  const suggestions = useQuery({
    queryKey: ["companies", "names", search],
    queryFn: () => companiesApi.options({ status: "ACTIVE", search }),
    enabled: search.length >= 2,
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <Input
        ref={ref}
        id={id}
        list={listId}
        autoComplete="off"
        placeholder="e.g. Asama.ai"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        className={invalid ? "border-rose-400" : undefined}
      />
      <datalist id={listId}>
        {suggestions.data?.map((company) => <option key={company.id} value={company.name} />)}
      </datalist>
    </>
  );
});
