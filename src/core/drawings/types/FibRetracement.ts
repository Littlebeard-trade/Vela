import type { Projector } from '../geometry';
import type { SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { LINE_STYLE_OPTIONS } from '../schema';
import type { LineStyle } from '../../model/series';
import { distToSegment } from '../hittest';
import { DEFAULT_DRAWING_COLOR } from '../style';
import { LEVEL_ANCHOR } from '../levelPalette';
import { FIB_PRESETS } from '../fibPresets';
import { FibLevels } from './FibLevels';
import type { FibBand, FibEntryLine, FibLevel, FibTrendSegment } from './FibRatios';

/** What a new retracement starts with (LB): the classic pullbacks plus the extensions out to
 *  4.236 — upstream starts on the classic seven. Same ladder as the presets; only more are on. */
const FULL_ON: ReadonlySet<number> = new Set([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]);
const LEVELS: readonly FibLevel[] = FIB_PRESETS[0]!.levels.map((l) => ({ ...l, enabled: FULL_ON.has(l.ratio) }));

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

const TREND_DEFAULT: FibTrendLineStyle = { visible: true, color: LEVEL_ANCHOR, width: 1, style: 'dashed' };
const LINE_STYLES: readonly string[] = LINE_STYLE_OPTIONS.map((o) => o.value);

/** The options this class adds on top of the upstream level / label / background props. */
interface LbOptions {
    trendLine: FibTrendLineStyle;
    levelsFormat: FibLevelsFormat;
    labelsV: FibLabelsV;
    /** Band transparency 0 (opaque) … 100 (invisible). */
    backgroundTransparency: number;
    useOneColor: boolean;
    oneColor: string;
}

/** What a NEW retracement starts with. */
const NEW_DEFAULTS: LbOptions = {
    trendLine: TREND_DEFAULT,
    levelsFormat: 'values',
    labelsV: 'middle',
    backgroundTransparency: 80,
    useOneColor: false,
    oneColor: DEFAULT_DRAWING_COLOR,
};

/**
 * What a drawing saved BEFORE these options existed (a record without `reverse`) resolves
 * to — exactly how it painted then: no trend line, the number above the line's left end,
 * and the painter's old 6% band.
 */
const LEGACY_DEFAULTS: LbOptions = {
    ...NEW_DEFAULTS,
    trendLine: { ...TREND_DEFAULT, visible: false },
    labelsV: 'top',
    backgroundTransparency: 94,
};

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isColor = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function sanitizeTrend(v: unknown, fallback: FibTrendLineStyle): FibTrendLineStyle | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Partial<FibTrendLineStyle>;
    return {
        visible: isBool(o.visible) ? o.visible : fallback.visible,
        color: isColor(o.color) ? o.color : fallback.color,
        width: typeof o.width === 'number' && o.width > 0 ? o.width : fallback.width,
        style: typeof o.style === 'string' && LINE_STYLES.includes(o.style) ? (o.style as LineStyle) : fallback.style,
    };
}

/** Format a ratio for its label: `0.618` or `61.8%`. */
export function formatFibRatio(ratio: number, format: FibLevelsFormat): string {
    return format === 'percents' ? `${Number((ratio * 100).toFixed(3))}%` : String(ratio);
}

const PAD = 4; // label inset from a line end (px)
const RISE = 7; // label offset above/below its line (px)

/**
 * Fibonacci retracement: horizontal levels between two swing anchors. Level 0 sits on the
 * second anchor and level 1 on the first (the move retraces from where it ended); `reverse`
 * puts level 0 on the first anchor instead.
 *
 * LB additions over upstream: a dashed trend line through the swing, ratios as values or
 * percents, the text placed by `labelSide` × `labelsV` (left / center / right × top / middle /
 * bottom), a translucent background with its own transparency, a single color for every
 * level, and the extended levels keeping the drawing in view past its anchors.
 */
export class FibRetracement extends FibLevels {
    readonly type = 'fibretracement' as const;

    /** Level 0 on the first anchor (the layout drawings had before the default flipped). */
    declare reverse: boolean;
    declare trendLine: FibTrendLineStyle;
    declare levelsFormat: FibLevelsFormat;
    declare labelsV: FibLabelsV;
    declare backgroundTransparency: number;
    declare useOneColor: boolean;
    declare oneColor: string;

    constructor(init: ConstructorParameters<typeof FibLevels>[0]) {
        super(init);
        // A persisted record's options were read (or legacy-defaulted) by readProps during
        // super(); anything still unset is a brand-new drawing → the new defaults.
        if (this.reverse === undefined) this.reverse = false;
        if (this.trendLine === undefined) this.trendLine = { ...NEW_DEFAULTS.trendLine };
        if (this.levelsFormat === undefined) this.levelsFormat = NEW_DEFAULTS.levelsFormat;
        if (this.labelsV === undefined) this.labelsV = NEW_DEFAULTS.labelsV;
        if (this.backgroundTransparency === undefined) this.backgroundTransparency = NEW_DEFAULTS.backgroundTransparency;
        if (this.useOneColor === undefined) this.useOneColor = NEW_DEFAULTS.useOneColor;
        if (this.oneColor === undefined) this.oneColor = NEW_DEFAULTS.oneColor;
    }

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }

    protected override levelPrice(ratio: number, p1: number, p2: number): number {
        return this.reverse ? p1 + ratio * (p2 - p1) : p2 + ratio * (p1 - p2);
    }

    /** `useOneColor` paints every level (line, number, band) in `oneColor`. */
    override levelLines(proj: Projector): ReturnType<FibLevels['levelLines']> {
        const lines = super.levelLines(proj);
        return lines && this.useOneColor ? lines.map((l) => ({ ...l, color: this.oneColor })) : lines;
    }

    override entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.levelLines(proj);
        if (!lines) return null;
        const h = this.labelSide;
        const v = this.labelsV;
        // Vertically centred text can't share the line: at a line end it sits just outside it
        // — unless the line runs off the pane on that side, where it tucks inside instead.
        const outsideLeft = v === 'middle' && !this.style.extendLeft;
        const outsideRight = v === 'middle' && !this.style.extendRight;
        return lines.map((l) => {
            const parts: string[] = [];
            if (this.showRatios) parts.push(formatFibRatio(l.ratio, this.levelsFormat));
            if (this.showPrices) parts.push(this.showRatios ? `(${l.price.toFixed(2)})` : l.price.toFixed(2));
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
                // The custom label sits centred above the line — below it when the numbers took that spot.
                labelY: h === 'center' && v === 'top' ? l.y + RISE : l.y - RISE,
            };
        });
    }

    override fillBands(proj: Projector): FibBand[] {
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
        return { min: this.style.extendLeft ? Number.NEGATIVE_INFINITY : e.min, max: this.style.extendRight ? Number.POSITIVE_INFINITY : e.max };
    }

    override schema(): SettingsSchema {
        const base = super.schema();
        return {
            fields: [
                ...base.fields,
                { path: 'trendLine.visible', label: 'Show trend line', kind: 'boolean', group: 'line' },
                { path: 'trendLine.color', label: 'Trend line color', kind: 'color', group: 'line', when: { path: 'trendLine.visible', in: [true] } },
                { path: 'trendLine.style', label: 'Trend line style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line', when: { path: 'trendLine.visible', in: [true] } },
                { path: 'trendLine.width', label: 'Trend line width', kind: 'number', min: 1, max: 10, step: 1, group: 'line', when: { path: 'trendLine.visible', in: [true] } },
                {
                    path: 'levelsFormat',
                    label: 'Level numbers',
                    kind: 'select',
                    group: 'text',
                    options: [
                        { value: 'values', label: 'Values (0.618)' },
                        { value: 'percents', label: 'Percents (61.8%)' },
                    ],
                },
                {
                    path: 'labelsV',
                    label: 'Label position',
                    kind: 'select',
                    group: 'text',
                    options: [
                        { value: 'top', label: 'Above the line' },
                        { value: 'middle', label: 'On the line' },
                        { value: 'bottom', label: 'Below the line' },
                    ],
                },
                { path: 'backgroundTransparency', label: 'Background transparency', kind: 'number', min: 0, max: 100, step: 5, group: 'fill', when: { path: 'background', in: [true] } },
                { path: 'useOneColor', label: 'One color for all levels', kind: 'boolean', group: 'fill' },
                { path: 'oneColor', label: 'Level color', kind: 'color', group: 'fill', when: { path: 'useOneColor', in: [true] } },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return {
            ...super.writeProps(),
            reverse: this.reverse,
            trendLine: { ...this.trendLine },
            levelsFormat: this.levelsFormat,
            labelsV: this.labelsV,
            backgroundTransparency: this.backgroundTransparency,
            useOneColor: this.useOneColor,
            oneColor: this.oneColor,
        };
    }

    protected override readProps(props: Record<string, unknown>): void {
        super.readProps(props);
        const hadFlag = typeof props.reverse === 'boolean';
        // A document saved before the flag existed was laid out with level 0 on the first
        // anchor; keep it that way instead of letting it jump to the new default. Only
        // while constructing: a later partial patch without the key must not flip it.
        if (hadFlag) this.reverse = props.reverse as boolean;
        else if (this.reverse === undefined) this.reverse = true;
        // While constructing, every option is still unset: a record without `reverse` predates
        // these options → LEGACY look; otherwise a malformed key falls back to the new default.
        // Later partial patches leave unmentioned options alone.
        const fb = hadFlag || this.trendLine !== undefined ? NEW_DEFAULTS : LEGACY_DEFAULTS;
        const self = this as unknown as Record<string, unknown>;
        const set = (k: keyof LbOptions, v: unknown): void => {
            if (v !== undefined) self[k] = v;
            else if (self[k] === undefined) self[k] = k === 'trendLine' ? { ...fb.trendLine } : fb[k];
        };
        set('trendLine', sanitizeTrend(props.trendLine, (self.trendLine as FibTrendLineStyle | undefined) ?? fb.trendLine));
        set('levelsFormat', props.levelsFormat === 'values' || props.levelsFormat === 'percents' ? props.levelsFormat : undefined);
        set('labelsV', props.labelsV === 'top' || props.labelsV === 'middle' || props.labelsV === 'bottom' ? props.labelsV : undefined);
        set('backgroundTransparency', typeof props.backgroundTransparency === 'number' && Number.isFinite(props.backgroundTransparency) ? Math.min(100, Math.max(0, props.backgroundTransparency)) : undefined);
        set('useOneColor', isBool(props.useOneColor) ? props.useOneColor : undefined);
        set('oneColor', isColor(props.oneColor) ? props.oneColor : undefined);
        this.readFork(props);
    }

    /**
     * Records saved by the LB fork before it adopted upstream's names: `showLevels` was
     * upstream's `showRatios`, `fillBackground` its `background`, `labelsH` its `labelSide`
     * (now also `center`), and the extend flags lived in props rather than the style.
     */
    private readFork(props: Record<string, unknown>): void {
        if (typeof props.showLevels === 'boolean' && typeof props.showRatios !== 'boolean') this.showRatios = props.showLevels;
        if (typeof props.fillBackground === 'boolean' && typeof props.background !== 'boolean') this.background = props.fillBackground;
        if ((props.labelsH === 'left' || props.labelsH === 'center' || props.labelsH === 'right') && props.labelSide === undefined) this.labelSide = props.labelsH;
        if (typeof props.extendLeft === 'boolean' && this.style.extendLeft === undefined) this.style = { ...this.style, extendLeft: props.extendLeft };
        if (typeof props.extendRight === 'boolean' && this.style.extendRight === undefined) this.style = { ...this.style, extendRight: props.extendRight };
    }
}
