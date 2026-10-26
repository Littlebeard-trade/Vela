// DatePicker CONTROLLER — the calendar's state, no DOM. Three panels: the days of a month,
// the twelve months of a year, and a decade of years. The header month and year switch to
// their panel; picking a year leads to its months and picking a month back to its days.
// Dates travel as local `YYYY-MM-DD` strings. Names, digits and the first day of the week
// follow the `i18n` translator's locale (English, weeks from Sunday, without one); the
// calendar is always Gregorian.
import { msg } from '../../../core/i18n/message';
import { englishTranslator, formatSettingsOf } from '../../../core/i18n/translator';
import type { Translator } from '../../../core/i18n/types';
import { monthNames, plainInteger, weekdayNames, yearBeforeMonth, yearLabel } from '../../../core/format/calendar';

export type DatePickerPanel = 'date' | 'month' | 'year';

export interface DatePickerControllerOptions {
    /** The selected date (`YYYY-MM-DD`); the calendar opens on its month. */
    value?: string;
    /** "Today" for the today ring and the initial month when nothing is selected. */
    today?: Date;
    /** The translator whose locale names the months and weekdays, picks the first day of
     *  the week and the digits: `chart.i18n` inside a chart, `createTranslator(...)`
     *  elsewhere. Default: English, weeks starting on Sunday. */
    i18n?: Translator;
}

/** One cell of the current panel. `blank` cells pad the first week of a month. */
export interface DatePickerCell {
    label: string;
    /** The day (`YYYY-MM-DD`) on the date panel; the month index or the year otherwise. */
    value: string | number;
    checked: boolean;
    today: boolean;
    /** A padding year outside the decade on the year panel. */
    outside?: boolean;
    blank?: boolean;
}

export interface DatePickerController {
    readonly panel: DatePickerPanel;
    readonly year: number;
    readonly month: number;
    readonly value: string | null;
    /** Whether the locale writes the year before the month (the header's switch order). */
    readonly yearFirst: boolean;
    /** The weekday column labels, starting on the locale's first day of the week. */
    weekdays(): string[];
    /** Header text: the month switch (hidden off the date panel) and the year switch. */
    header(): { month: string; monthVisible: boolean; year: string; yearDisabled: boolean };
    /** What the arrows step on the current panel. */
    navLabels(): { prev: string; next: string };
    cells(): DatePickerCell[];
    /** One month, one year or ten, depending on the panel. */
    step(dir: 1 | -1): void;
    showMonths(): void;
    showYears(): void;
    /** Activate a cell: a day returns its date (the pick); a month or year only navigates. */
    choose(cell: DatePickerCell): string | null;
    /** Rewrite the selection without emitting (and open on its month). */
    setValue(value: string | null): void;
}

/** @deprecated English only. The picker names months in its `i18n` locale; read the
 *  shown name from `controller.header().month`. */
export const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** @deprecated English only. The picker names weekdays in its `i18n` locale, from the
 *  locale's first day of the week; read them from `controller.weekdays()`. */
export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

const NAV = {
    prevMonth: msg('ui.datePicker.previousMonth', 'Previous month'),
    nextMonth: msg('ui.datePicker.nextMonth', 'Next month'),
    prevYear: msg('ui.datePicker.previousYear', 'Previous year'),
    nextYear: msg('ui.datePicker.nextYear', 'Next year'),
    prevDecade: msg('ui.datePicker.previousDecade', 'Previous decade'),
    nextDecade: msg('ui.datePicker.nextDecade', 'Next decade'),
};

/** `YYYY-MM-DD` for a local date. */
export function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Accept `YYYY-MM-DD` or `YYYY-M-D` and return a padded ISO date, or null if unusable. */
export function normalizeDateInput(raw: string): string | null {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return isoDate(dt);
}

function parseIsoDate(raw: string | null | undefined): Date | null {
    const iso = raw ? normalizeDateInput(raw) : null;
    if (!iso) return null;
    const [y, mo, d] = iso.split('-').map(Number);
    return new Date(y!, mo! - 1, d!);
}

export function datePickerController(opts: DatePickerControllerOptions = {}): DatePickerController {
    const today = opts.today ?? new Date();
    let selected = parseIsoDate(opts.value);
    let year = selected?.getFullYear() ?? today.getFullYear();
    let month = selected?.getMonth() ?? today.getMonth();
    let panel: DatePickerPanel = 'date';
    const i18n = opts.i18n ?? englishTranslator();
    const settings = formatSettingsOf(i18n);
    // Without a translator the picker keeps its historical Sunday-first grid.
    const weekStart = opts.i18n ? i18n.weekStart : 0;
    const monthsLong = monthNames(settings, 'long');
    const monthsShort = monthNames(settings, 'short');
    const num = (n: number): string => plainInteger(settings, n);

    const decade = (): number => Math.floor(year / 10) * 10;

    return {
        get panel() {
            return panel;
        },
        get year() {
            return year;
        },
        get month() {
            return month;
        },
        get value() {
            return selected ? isoDate(selected) : null;
        },
        yearFirst: yearBeforeMonth(settings),
        weekdays() {
            const names = weekdayNames(settings);
            return Array.from({ length: 7 }, (_, i) => names[(weekStart + i) % 7]!);
        },
        header() {
            return {
                month: monthsLong[month] ?? '',
                monthVisible: panel === 'date',
                year: panel === 'year' ? `${num(decade())}-${num(decade() + 9)}` : yearLabel(settings, year),
                yearDisabled: panel === 'year', // in the decade panel the year reads as its title
            };
        },
        navLabels() {
            if (panel === 'date') return { prev: i18n.t(NAV.prevMonth), next: i18n.t(NAV.nextMonth) };
            if (panel === 'month') return { prev: i18n.t(NAV.prevYear), next: i18n.t(NAV.nextYear) };
            return { prev: i18n.t(NAV.prevDecade), next: i18n.t(NAV.nextDecade) };
        },
        cells() {
            const out: DatePickerCell[] = [];
            if (panel === 'date') {
                const startPad = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
                const days = new Date(year, month + 1, 0).getDate();
                const todayIso = isoDate(today);
                const selectedIso = selected ? isoDate(selected) : '';
                for (let i = 0; i < startPad; i++) out.push({ label: '', value: '', checked: false, today: false, blank: true });
                for (let day = 1; day <= days; day++) {
                    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    out.push({ label: num(day), value: iso, checked: iso === selectedIso, today: iso === todayIso });
                }
                return out;
            }
            if (panel === 'month') {
                for (let m = 0; m < 12; m++) {
                    out.push({
                        label: monthsShort[m] ?? '',
                        value: m,
                        checked: selected?.getFullYear() === year && selected.getMonth() === m,
                        today: today.getFullYear() === year && today.getMonth() === m,
                    });
                }
                return out;
            }
            // One padding year on each side, so the decade fills the same 3×4 grid as the months.
            const d = decade();
            for (let y = d - 1; y <= d + 10; y++) {
                out.push({ label: num(y), value: y, checked: selected?.getFullYear() === y, today: today.getFullYear() === y, outside: y < d || y > d + 9 });
            }
            return out;
        },
        step(dir) {
            if (panel === 'date') {
                month += dir;
                if (month < 0) {
                    month = 11;
                    year -= 1;
                }
                if (month > 11) {
                    month = 0;
                    year += 1;
                }
            } else {
                year += panel === 'month' ? dir : dir * 10;
            }
        },
        showMonths() {
            panel = 'month';
        },
        showYears() {
            panel = 'year';
        },
        choose(cell) {
            if (cell.blank) return null;
            if (panel === 'date') {
                selected = parseIsoDate(String(cell.value));
                return selected ? isoDate(selected) : null;
            }
            if (panel === 'month') {
                month = Number(cell.value);
                panel = 'date';
                return null;
            }
            year = Number(cell.value);
            panel = 'month';
            return null;
        },
        setValue(value) {
            selected = parseIsoDate(value);
            if (selected) {
                year = selected.getFullYear();
                month = selected.getMonth();
            }
            panel = 'date';
        },
    };
}
