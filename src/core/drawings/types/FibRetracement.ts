import type { SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { LineStyle } from '../../model/series';
import { FibLevels } from './FibLevels';
import type { FibBand, FibEntryLine, FibLevel, FibTrendSegment } from './FibRatios';
import { distToSegment } from '../hittest';
import { fibLevels, LEVEL_ANCHOR, LEVEL_PURPLE } from '../levelPalette';
import { DEFAULT_DRAWING_COLOR } from '../style';

/** The standard enabled retracement set: the swing (0 → 1) plus its extensions to 4.236. */
const LEVELS = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, { ratio: 3.618, color: LEVEL_PURPLE }, 4.236]);

export type FibLabelsH = 'left' | 'center' | 'right';
export type FibLabelsV = 'top' | 'middle' | 'bottom';
/** How the level ratio prints: `values` = 0.618, `percents` = 61.8%. */
export type FibLevelsFormat = 'values' | 'percents';

/** The anchor-to-anchor line drawn through the swing (dashed by default). */
export interface FibTrendLineStyle {
    visible: boolean;
    color: string;
    width: number;
    style: LineStyle;
}

/** The display options a retracement persists in `props` (besides levels + sizes). */
export interface FibRetracementOptions {
    /** False (default): 1 at the first anchor, 0 at the second. True: 0 at the first. */
    reverse: boolean;
    trendLine: FibTrendLineStyle;
    extendLeft: boolean;
    extendRight: boolean;
    showPrices: boolean;
    showLevels: boolean;
    levelsFormat: FibLevelsFormat;
    labelsH: FibLabelsH;
    labelsV: FibLabelsV;
    fillBackground: boolean;
    /** Band transparency 0 (opaque) … 100 (invisible). */
    backgroundTransparency: number;
    useOneColor: boolean;
    oneColor: string;
}

const TREND_DEFAULT: FibTrendLineStyle = { visible: true, color: LEVEL_ANCHOR, width: 1, style: 'dashed' };

/** What a NEW retracement starts with. */
const NEW_DEFAULTS: FibRetracementOptions = {
    reverse: false,
    trendLine: TREND_DEFAULT,
    extendLeft: false,
    extendRight: false,
    showPrices: true,
    showLevels: true,
    levelsFormat: 'values',
    labelsH: 'left',
    labelsV: 'middle',
    fillBackground: true,
    backgroundTransparency: 80,
    useOneColor: false,
    oneColor: DEFAULT_DRAWING_COLOR,
};

/**
 * What a drawing saved BEFORE these options existed (props without the key) resolves to —
 * exactly how it painted then: 0 at the first anchor, no trend line, the number inside the
 * left end above the line, and the painter's old 6% band.
 */
const LEGACY_DEFAULTS: FibRetracementOptions = {
    ...NEW_DEFAULTS,
    reverse: true,
    trendLine: { ...TREND_DEFAULT, visible: false },
    labelsH: 'left',
    labelsV: 'top',
    backgroundTransparency: 94,
};

const OPTION_KEYS = Object.keys(NEW_DEFAULTS) as Array<keyof FibRetracementOptions>;
const LINE_STYLES: readonly string[] = ['solid', 'dashed', 'dotted'];
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isColor = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validate one untrusted option value; `undefined` when it isn't usable. */
function sanitizeOption<K extends keyof FibRetracementOptions>(key: K, v: unknown, fallback: FibRetracementOptions[K]): FibRetracementOptions[K] | undefined {
    switch (key) {
        case 'labelsH':
            return (v === 'left' || v === 'center' || v === 'right' ? v : undefined) as FibRetracementOptions[K] | undefined;
        case 'labelsV':
            return (v === 'top' || v === 'middle' || v === 'bottom' ? v : undefined) as FibRetracementOptions[K] | undefined;
        case 'levelsFormat':
            return (v === 'values' || v === 'percents' ? v : undefined) as FibRetracementOptions[K] | undefined;
        case 'backgroundTransparency':
            return (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : undefined) as FibRetracementOptions[K] | undefined;
        case 'oneColor':
            return (isColor(v) ? v : undefined) as FibRetracementOptions[K] | undefined;
        case 'trendLine': {
            if (!v || typeof v !== 'object') return undefined;
            const o = v as Partial<FibTrendLineStyle>;
            const f = fallback as FibTrendLineStyle;
            return {
                visible: isBool(o.visible) ? o.visible : f.visible,
                color: isColor(o.color) ? o.color : f.color,
                width: typeof o.width === 'number' && o.width > 0 ? o.width : f.width,
                style: typeof o.style === 'string' && LINE_STYLES.includes(o.style) ? o.style : f.style,
            } as FibRetracementOptions[K];
        }
        default:
            return (isBool(v) ? v : undefined) as FibRetracementOptions[K] | undefined;
    }
}

/** Format a ratio for its label: `0.618` or `61.8%`. */
export function formatFibRatio(ratio: number, format: FibLevelsFormat): string {
    return format === 'percents' ? `${Number((ratio * 100).toFixed(3))}%` : String(ratio);
}

const PAD = 4; // label inset from a line end (px)
const RISE = 7; // label offset above/below its line (px)

/**
 * Fibonacci retracement: horizontal levels between two swing anchors. By default ratio 1
 * sits on the FIRST click and 0 on the second — the move retraces from where it ended —
 * (`reverse` flips it), with a dashed trend line through the swing, optional extension
 * to the pane edges, price / ratio text placed by `labelsH` × `labelsV`, a translucent
 * background, and an optional single color for every level.
 */
export class FibRetracement extends FibLevels implements FibRetracementOptions {
    readonly type = 'fibretracement' as const;

    reverse!: boolean;
    trendLine!: FibTrendLineStyle;
    extendLeft!: boolean;
    extendRight!: boolean;
    showPrices!: boolean;
    showLevels!: boolean;
    levelsFormat!: FibLevelsFormat;
    labelsH!: FibLabelsH;
    labelsV!: FibLabelsV;
    fillBackground!: boolean;
    backgroundTransparency!: number;
    useOneColor!: boolean;
    oneColor!: string;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        // Options a persisted record carried were read (or legacy-defaulted) by readProps
        // during super(); anything still unset is a brand-new drawing → the new defaults.
        const self = this as unknown as Record<string, unknown>;
        for (const k of OPTION_KEYS) {
            if (self[k] === undefined) self[k] = clone(NEW_DEFAULTS[k]);
        }
    }

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }

    /** Default orientation: 1 at the first anchor, 0 at the second; `reverse` → 0 at the first. */
    protected override levelBase(): { origin: number; delta: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return this.reverse ? { origin: a.price, delta: b.price - a.price } : { origin: b.price, delta: a.price - b.price };
    }

    protected override levelSpan(proj: Projector, x1: number, x2: number): [number, number] {
        return [this.extendLeft ? Math.min(0, x1) : x1, this.extendRight ? Math.max(proj.width, x2) : x2];
    }

    protected override levelPaint(color: string): string {
        return this.useOneColor ? this.oneColor : color;
    }

    override entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.levelLines(proj);
        if (!lines) return null;
        const h = this.labelsH;
        const v = this.labelsV;
        // Vertically centered text can't share the line: at a line end it sits just outside
        // it — unless the line runs off the pane on that side, where it tucks inside instead.
        const outsideLeft = v === 'middle' && !this.extendLeft;
        const outsideRight = v === 'middle' && !this.extendRight;
        return lines.map((l) => {
            const parts: string[] = [];
            if (this.showLevels) parts.push(formatFibRatio(l.ratio, this.levelsFormat));
            if (this.showPrices) parts.push(this.showLevels ? `(${l.price.toFixed(2)})` : l.price.toFixed(2));
            let numberX: number;
            let numberAlign: FibEntryLine['numberAlign'];
            if (h === 'left') {
                numberX = outsideLeft ? l.x1 - PAD : l.x1 + PAD;
                numberAlign = outsideLeft ? 'right' : 'left';
            } else if (h === 'right') {
                numberX = outsideRight ? l.x2 + PAD : l.x2 - PAD;
                numberAlign = outsideRight ? 'left' : 'right';
            } else {
                numberX = (l.x1 + l.x2) / 2;
                numberAlign = 'center';
            }
            const numberY = v === 'top' ? l.y - RISE : v === 'bottom' ? l.y + RISE : l.y;
            return {
                color: l.color,
                label: l.label,
                x1: l.x1,
                y1: l.y,
                x2: l.x2,
                y2: l.y,
                numberText: parts.join(' '),
                numberX,
                numberY,
                numberAlign,
                labelX: (l.x1 + l.x2) / 2,
                // The custom label sits centered above the line — below it when the numbers took that spot.
                labelY: h === 'center' && v === 'top' ? l.y + RISE : l.y - RISE,
            };
        });
    }

    override fillBands(proj: Projector): FibBand[] {
        if (!this.fillBackground) return [];
        const opacity = 1 - this.backgroundTransparency / 100;
        return super.fillBands(proj).map((b) => ({ ...b, opacity }));
    }

    override trendSegment(proj: Projector): FibTrendSegment | null {
        const t = this.trendLine;
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!t.visible || !a || !b) return null;
        const y1 = proj.yOf(a.price, this.paneId);
        const y2 = proj.yOf(b.price, this.paneId);
        if (y1 == null || y2 == null) return null;
        return { x1: proj.xOf(a.time), y1, x2: proj.xOf(b.time), y2, color: t.color, width: t.width, style: t.style };
    }

    override hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        if (super.hitTest(px, py, proj, tol)) return true;
        const t = this.trendSegment(proj);
        return t != null && distToSegment(px, py, t.x1, t.y1, t.x2, t.y2) <= tol;
    }

    // Extended levels reach the pane edge, so the drawing stays visible past its anchors.
    override timeExtent(): { min: number; max: number } | null {
        const e = super.timeExtent();
        if (!e) return null;
        return { min: this.extendLeft ? Number.NEGATIVE_INFINITY : e.min, max: this.extendRight ? Number.POSITIVE_INFINITY : e.max };
    }

    protected override writeProps(): Record<string, unknown> {
        const out = super.writeProps();
        const self = this as unknown as Record<string, unknown>;
        for (const k of OPTION_KEYS) out[k] = clone(self[k]);
        return out;
    }

    protected override readProps(props: Record<string, unknown>): void {
        super.readProps(props);
        const self = this as unknown as Record<string, unknown>;
        // While constructing, every option is still unset. A record without `reverse` predates
        // these options → each one takes its LEGACY value (renders as before); a newer record
        // falls back to the new defaults for a malformed key. Later partial patches leave
        // unmentioned options alone.
        const fallback = typeof props.reverse === 'boolean' ? NEW_DEFAULTS : LEGACY_DEFAULTS;
        for (const k of OPTION_KEYS) {
            const current = (self[k] as FibRetracementOptions[typeof k] | undefined) ?? fallback[k];
            const v = sanitizeOption(k, props[k], current);
            if (v !== undefined) self[k] = v;
            else if (self[k] === undefined) self[k] = clone(fallback[k]);
        }
    }
}

function clone<T>(v: T): T {
    return v && typeof v === 'object' ? ({ ...v } as T) : v;
}
