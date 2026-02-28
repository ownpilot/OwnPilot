import { useState, useCallback, useMemo } from 'react';

const INPUT_CLS =
  'w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

type PresetType = 'every-minute' | 'every-hour' | 'daily' | 'weekly' | 'custom';

const PRESETS = {
  'every-minute': { label: 'Every minute', cron: '*/1 * * * *' },
  'every-hour': { label: 'Every hour', cron: '0 * * * *' },
  daily: { label: 'Every day at midnight', cron: '0 0 * * *' },
  weekly: { label: 'Every Monday at 9 AM', cron: '0 9 * * 1' },
  custom: { label: 'Custom', cron: '' },
};

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const DAYS_OF_WEEK = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

function parseCron(cron: string): CronParts {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { minute: '*', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*' };
  }
  return {
    minute: parts[0] ?? '*',
    hour: parts[1] ?? '*',
    dayOfMonth: parts[2] ?? '*',
    month: parts[3] ?? '*',
    dayOfWeek: parts[4] ?? '*',
  };
}

function buildCron(parts: CronParts): string {
  return `${parts.minute} ${parts.hour} ${parts.dayOfMonth} ${parts.month} ${parts.dayOfWeek}`;
}

function detectPreset(cron: string): PresetType {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (preset.cron === cron) {
      return key as PresetType;
    }
  }
  return 'custom';
}

function getHumanReadable(parts: CronParts): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = parts;

  // Every minute
  if (
    minute === '*/1' &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return 'Runs every minute';
  }

  // Every N minutes
  const everyMinuteMatch = minute.match(/^\*\/(\d+)$/);
  if (
    everyMinuteMatch &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Runs every ${everyMinuteMatch[1]} minutes`;
  }

  // Every hour
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Runs every hour';
  }

  // Every N hours
  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (
    minute === '0' &&
    everyHourMatch &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Runs every ${everyHourMatch[1]} hours`;
  }

  // Daily at specific time
  if (
    minute !== '*' &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    (dayOfWeek === '*' || dayOfWeek === '?')
  ) {
    const hourNum = parseInt(hour, 10);
    const minNum = parseInt(minute, 10);
    if (!isNaN(hourNum) && !isNaN(minNum)) {
      return `Runs every day at ${hourNum.toString().padStart(2, '0')}:${minNum.toString().padStart(2, '0')}`;
    }
  }

  // Weekly on specific day
  const dayOfWeekNum = parseInt(dayOfWeek, 10);
  if (
    minute !== '*' &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    !isNaN(dayOfWeekNum) &&
    dayOfWeekNum >= 0 &&
    dayOfWeekNum <= 6
  ) {
    const hourNum = parseInt(hour, 10);
    const minNum = parseInt(minute, 10);
    const dayName = DAYS_OF_WEEK[dayOfWeekNum]?.label ?? 'Unknown';
    if (!isNaN(hourNum) && !isNaN(minNum)) {
      return `Runs every ${dayName} at ${hourNum.toString().padStart(2, '0')}:${minNum.toString().padStart(2, '0')}`;
    }
  }

  // Monthly on specific day
  const dayOfMonthNum = parseInt(dayOfMonth, 10);
  if (
    minute !== '*' &&
    hour !== '*' &&
    !isNaN(dayOfMonthNum) &&
    dayOfMonthNum >= 1 &&
    dayOfMonthNum <= 31 &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const hourNum = parseInt(hour, 10);
    const minNum = parseInt(minute, 10);
    if (!isNaN(hourNum) && !isNaN(minNum)) {
      return `Runs on day ${dayOfMonthNum} of every month at ${hourNum.toString().padStart(2, '0')}:${minNum.toString().padStart(2, '0')}`;
    }
  }

  // Generic fallback
  return `Runs at: ${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
}

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const [activePreset, setActivePreset] = useState<PresetType>(detectPreset(value));
  const [parts, setParts] = useState<CronParts>(parseCron(value));

  const humanReadable = useMemo(() => getHumanReadable(parts), [parts]);

  const handlePresetClick = useCallback(
    (preset: PresetType) => {
      setActivePreset(preset);
      if (preset !== 'custom') {
        const cronValue = PRESETS[preset].cron;
        const newParts = parseCron(cronValue);
        setParts(newParts);
        onChange(cronValue);
      }
    },
    [onChange]
  );

  const handlePartChange = useCallback(
    (field: keyof CronParts, newValue: string) => {
      const newParts = { ...parts, [field]: newValue };
      setParts(newParts);
      const newCron = buildCron(newParts);
      onChange(newCron);
      setActivePreset('custom');
    },
    [parts, onChange]
  );

  return (
    <div className="space-y-3">
      {/* Preset Buttons */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(PRESETS) as PresetType[]).map((presetKey) => (
          <button
            key={presetKey}
            type="button"
            onClick={() => handlePresetClick(presetKey)}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              activePreset === presetKey
                ? 'bg-violet-500/20 border-violet-400 text-violet-600 dark:text-violet-400'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-violet-400/50'
            }`}
          >
            {PRESETS[presetKey].label}
          </button>
        ))}
      </div>

      {/* Custom Fields */}
      {activePreset === 'custom' && (
        <div className="space-y-2">
          {/* Minute */}
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Minute
            </label>
            <select
              value={parts.minute}
              onChange={(e) => handlePartChange('minute', e.target.value)}
              className={INPUT_CLS}
            >
              <option value="*">Every minute (*)</option>
              <option value="0">At minute 0</option>
              <option value="*/5">Every 5 minutes (*/5)</option>
              <option value="*/10">Every 10 minutes (*/10)</option>
              <option value="*/15">Every 15 minutes (*/15)</option>
              <option value="*/30">Every 30 minutes (*/30)</option>
              {Array.from({ length: 60 }, (_, i) => (
                <option key={i} value={i.toString()}>
                  At minute {i}
                </option>
              ))}
            </select>
          </div>

          {/* Hour */}
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Hour
            </label>
            <select
              value={parts.hour}
              onChange={(e) => handlePartChange('hour', e.target.value)}
              className={INPUT_CLS}
            >
              <option value="*">Every hour (*)</option>
              <option value="*/2">Every 2 hours (*/2)</option>
              <option value="*/4">Every 4 hours (*/4)</option>
              <option value="*/6">Every 6 hours (*/6)</option>
              <option value="*/12">Every 12 hours (*/12)</option>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i.toString()}>
                  At hour {i.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>

          {/* Day of Month */}
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Day of Month
            </label>
            <select
              value={parts.dayOfMonth}
              onChange={(e) => handlePartChange('dayOfMonth', e.target.value)}
              className={INPUT_CLS}
            >
              <option value="*">Every day (*)</option>
              {Array.from({ length: 31 }, (_, i) => {
                const day = i + 1;
                return (
                  <option key={day} value={day.toString()}>
                    Day {day}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Month */}
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Month
            </label>
            <select
              value={parts.month}
              onChange={(e) => handlePartChange('month', e.target.value)}
              className={INPUT_CLS}
            >
              <option value="*">Every month (*)</option>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Day of Week */}
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Day of Week
            </label>
            <select
              value={parts.dayOfWeek}
              onChange={(e) => handlePartChange('dayOfWeek', e.target.value)}
              className={INPUT_CLS}
            >
              <option value="*">Every day (*)</option>
              {DAYS_OF_WEEK.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Live Preview */}
      <div className="bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-md px-3 py-2">
        <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-0.5">
          Schedule Preview
        </div>
        <div className="text-sm text-text-primary dark:text-dark-text-primary">{humanReadable}</div>
        <div className="text-xs text-text-muted dark:text-dark-text-muted mt-1 font-mono">
          {buildCron(parts)}
        </div>
      </div>
    </div>
  );
}
