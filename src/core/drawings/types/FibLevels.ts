import type { Projector } from '../geometry';
import { FibRatios, type FibBand, type FibEntryLine } from './FibRatios';

/** A resolved (enabled) level in pixels: its price, color, label, and line to stroke. */
export interface FibLevelLine {
    ratio: number;
    color: string;
    label?: string;
    price: number;
    x1: number;
    x2: number;
    y: number;
}

/**
 * Shared base for the horizontal Fibonacci level tools (retracement, extension): two
 * anchors define a price range; each level is a horizontal line at
 * `origin + ratio·delta` (by default `p1.price + ratio·(p2.price − p1.price)` — see
 * {@link levelBase}), spanning the anchors' time range, with fill bands between
 * consecutive levels. Subclasses declare the default ratio set and may re-orient
 * ({@link levelBase}) or widen ({@link levelSpan}) the levels.
 */
export abstract class FibLevels extends FibRatios {
    /** The price ratio 0 sits at (`origin`) and the signed span ratio 1 adds (`delta`).
     *  Default: 0 at the first anchor, 1 at the second. */
    protected levelBase(): { origin: number; delta: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { origin: a.price, delta: b.price - a.price };
    }

    /** Horizontal pixel extent of every level line, from the anchors' span (default: as-is). */
    protected levelSpan(_proj: Projector, x1: number, x2: number): [number, number] {
        return [x1, x2];
    }

    /** The color a level paints with (lines, numbers, bands) — its own by default. */
    protected levelPaint(color: string): string {
        return color;
    }

    /** Per-level pixel line + price for the ENABLED levels, spanning the anchors' time range. */
    levelLines(proj: Projector): FibLevelLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const base = this.levelBase();
        if (!a || !b || !base) return null;
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        const [x1, x2] = this.levelSpan(proj, Math.min(xa, xb), Math.max(xa, xb));
        const out: FibLevelLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const price = base.origin + lv.ratio * base.delta;
            const y = proj.yOf(price, this.paneId);
            if (y == null) continue;
            out.push({ ratio: lv.ratio, color: this.levelPaint(lv.color), label: lv.label, price, x1, x2, y });
        }
        return out;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.levelLines(proj);
        if (!lines) return null;
        return lines.map((l) => ({
            color: l.color,
            label: l.label,
            x1: l.x1,
            y1: l.y,
            x2: l.x2,
            y2: l.y,
            numberText: `${l.ratio} (${l.price.toFixed(2)})`,
            numberX: l.x1 + 4,
            numberY: l.y - 7,
            numberAlign: 'left',
            labelX: (l.x1 + l.x2) / 2,
            labelY: l.y - 7,
        }));
    }

    override fillBands(proj: Projector): FibBand[] {
        const lines = this.levelLines(proj);
        if (!lines) return [];
        const bands: FibBand[] = [];
        for (let i = 1; i < lines.length; i += 1) {
            const a = lines[i - 1]!;
            const b = lines[i]!;
            bands.push({ color: b.color, x: a.x1, y: Math.min(a.y, b.y), w: a.x2 - a.x1, h: Math.abs(b.y - a.y) });
        }
        return bands;
    }

    priceRange(): { min: number; max: number } | null {
        const base = this.levelBase();
        if (!base) return null;
        const prices = this.levels.filter((l) => l.enabled).map((l) => base.origin + l.ratio * base.delta);
        if (prices.length === 0) return null;
        return { min: Math.min(...prices), max: Math.max(...prices) };
    }
}
