/**
 * The one date-range bar for record lists: period chips (All time, Today,
 * Last 7 days, Last 30 days, Custom) and — once Custom is chosen — a From/To
 * pair of DatePickers. Used by every role's incident History and by the Super
 * Admin audit log, so the same periods mean the same thing everywhere.
 * The state itself is pure (lib/filters: DateRangeState, setPeriod,
 * setDateBound, inDateRange), which test/date-range.test.mjs pins down.
 */
import { DatePicker } from "./DatePicker";
import { ChipRow } from "./FilterBar";
import {
  PERIOD_OPTIONS,
  setDateBound,
  setPeriod,
  type DateRangeState,
  type PeriodId,
} from "../lib/filters";

export function DateRangeBar({
  value,
  onChange,
  ariaLabel = "Date range",
}: {
  value: DateRangeState;
  onChange: (next: DateRangeState) => void;
  /** Accessible name for the period chip row. */
  ariaLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <ChipRow
        ariaLabel={ariaLabel}
        options={PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
        value={value.period}
        onToggle={(v) => onChange(setPeriod(value, v as PeriodId))}
      />
      {value.period === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <DatePicker
            className="w-44"
            label="From"
            value={value.from}
            onChange={(v) => onChange(setDateBound(value, "from", v))}
            clearable
          />
          <DatePicker
            className="w-44"
            label="To"
            value={value.to}
            onChange={(v) => onChange(setDateBound(value, "to", v))}
            clearable
          />
        </div>
      )}
    </div>
  );
}

export default DateRangeBar;