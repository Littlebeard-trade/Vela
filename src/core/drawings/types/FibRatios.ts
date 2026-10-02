import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { LineStyle } from '../../model/series';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS } from '../schema';
import { distToSegment, handleAt } from '../hittest';

/** Text px per named size (mirrors the painter's namedFontSize; core can't import the renderer). */
const TEXT_PX: Record<string, number> = { tiny: 10, small: 12, normal: 14, large: 18, huge: 28 };

/** One configurable Fibonacci entry — a ratio (or sequence index) with color / enabled / label. */
export interface FibLevel {
    ratio: number;
    color: string;
    enabled: boolean;
    label?: string;
}

/** Font size for the entry numbers / labels (cycled by the bar buttons). */
export type FibTextSize = 'small' | 'normal' | 'large' | 'huge';
const isFibSize = (v: unknown): v is FibTextSize => v === 'small' || v === 'normal' || v === 'large' || v === 'huge';

/** Coerce an untrusted value into a valid level (defensive, for persistence/round-trip). */
export function sanitizeLevel(v: unknown): FibLevel | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Partial<FibLevel>;
    if (typeof o.ratio !== 'number' || typeof o.color !== 'string') return null;
    return {
        ratio: o.ratio,
        color: o.color,
        enabled: o.enabled !== false,
        ...(typeof o.label === 'string' && o.label ? { label: o.label } : {}),
    };
}

/** A resolved entry's pixel line + auto-number + custom-label placement (the painter's input). */
export interface FibEntryLine {
    color: string;
    label?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    numberText: string;
    numberX: number;
    numberY: number;
    numberAlign: 'left' | 'center' | 'right';
    labelX: number;
    labelY: number;
}

/** A fill band between two entries; `opacity` (0..1) overrides the painter's faint default. */
export interface FibBand {
    color: string;
    x: number;
    y: number;
    w: number;
    h: number;
    opacity?: number;
}

/** An extra stroked segment drawn under the entries (the retracement's anchor-to-anchor trend line). */
export interface FibTrendSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    width: number;
    style: LineStyle;
}

/**
 * Shared base for every Fibonacci tool (retracement, extension, fan, time zones,
 * trend extension). Holds the editable per-entry config — `levels` (ratio / color /
 * enabled / label) plus number/label font sizes — which drives the settings gear
 * panel, persisted through `props`. Hit-test, handles, schema, and serialization all
 * derive from the abstract {@link entryLines}; subclasses only supply their default
 * ratio set, anchor count, geometry (`entryLines`), and price range.
 */
export abstract class FibRatios extends Drawing {
    /** Editable per-entry config (seeded from {@link defaultLevels}, persisted via props). */
    levels!: FibLevel[];
    /** Font size of the auto numbers (bar button cycles it). */
    numbersSize!: FibTextSize;
    /** Font size of the custom labels (bar button cycles it). */
    labelsSize!: FibTextSize;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.levels) this.levels = this.defaultLevels().map((l) => ({ ...l }));
        if (!this.numbersSize) this.numbersSize = 'small';
        if (!this.labelsSize) this.labelsSize = 'normal';
    }

    /** The tool's default entry set (ratios + colors), all enabled. */
    abstract defaultLevels(): readonly FibLevel[];
    /** ENABLED entries resolved to pixel lines + label placement — the painter's input. */
    abstract entryLines(proj: Projector): FibEntryLine[] | null;
    /** Optional fill bands between entries (retracement/extension override); default none. */
    fillBands(_proj: Projector): FibBand[] {
        return [];
    }
    /** Optional anchor-to-anchor trend line painted under the entries (retracement); default none. */
    trendSegment(_proj: Projector): FibTrendSegment | null {
        return null;
    }

    override editableLevels(): FibLevel[] | null {
        return this.levels;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }] };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const lines = this.entryLines(proj);
        if (lines == null) return false;
        if (lines.some((l) => distToSegment(px, py, l.x1, l.y1, l.x2, l.y2) <= tol)) return true;
        // LB: a level's number / price text and its custom label select the drawing too (TradingView):
        // with extend off the numbers sit OUTSIDE the line, where a click used to miss
        const num = TEXT_PX[this.numbersSize] ?? 12, lbl = TEXT_PX[this.labelsSize] ?? 14;
        const inText = (text: string, x: number, y: number, align: 'left' | 'right' | 'center', size: number) => {
            if (!text) return false;
            const w = text.length * size * 0.6, h = size;             // ~average glyph width of UI fonts
            const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
            return px >= x0 - tol && px <= x0 + w + tol && py >= y - h / 2 - tol / 2 && py <= y + h / 2 + tol / 2;
        };
        return lines.some((l) => inText(l.numberText, l.numberX, l.numberY, l.numberAlign, num) || (!!l.label && inText(l.label, l.labelX, l.labelY, 'center', lbl)));
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const pts: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return [];
            pts.push([proj.xOf(a.time), y]);
        }
        return pts;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const pts = this.handlePoints(proj);
        if (pts.length === 0) return null;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    schema(): SettingsSchema {
        // Width + style apply to all entries; per-entry color/enable/label live in the gear panel.
        return { fields: LINE_FIELDS.filter((f) => f.path !== 'style.lineColor') };
    }

    protected override writeProps(): Record<string, unknown> {
        return { levels: this.levels.map((l) => ({ ...l })), numbersSize: this.numbersSize, labelsSize: this.labelsSize };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (Array.isArray(props.levels)) {
            const parsed = props.levels.map(sanitizeLevel).filter((l): l is FibLevel => l != null);
            if (parsed.length) this.levels = parsed;
        }
        if (isFibSize(props.numbersSize)) this.numbersSize = props.numbersSize;
        if (isFibSize(props.labelsSize)) this.labelsSize = props.labelsSize;
    }
}
