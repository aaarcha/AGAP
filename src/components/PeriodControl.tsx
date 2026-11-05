import { CalendarDays } from "lucide-react";
import { PERIOD_OPTIONS, setDateBound, setPeriod, type DateRangeState, type PeriodId } from "../lib/filters";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";

/**
 * The compact period control for a page header toolbar: a Select with a
 * calendar icon showing the current period ("Last 7 days"), and the DatePicker
 * range when "Custom range" is chosen.
 */
export function PeriodControl({
  value,
  onChange,
  className = "",
}: {
  value: DateRangeState;
  onChange: (next: DateRangeState) => void;
  className?: string;
}) {
  return (
    <div data-period-control className={`min-w-0 ${className}`.trim()}>
      <div className="relative min-w-0">
        <CalendarDays
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <Select
          ariaLabel="Period"
          value={value.period}
          onChange={(v) => onChange(setPeriod(value, v as PeriodId))}
          options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          triggerClassName="pl-9 font-semibold"
        />
      </div>
      {value.period === "custom" && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <DatePicker className="w-40" label="From" value={value.from} onChange={(v) => onChange(setDateBound(value, "from", v))} clearable />
          <DatePicker className="w-40" label="To" value={value.to} onChange={(v) => onChange(setDateBound(value, "to", v))} clearable />
        </div>
      )}
    </div>
  );
}

export default PeriodControl;
