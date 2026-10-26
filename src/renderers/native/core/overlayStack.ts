// The price pane's draw stack as the legend restacks it, one step forward or back: the
// pane's indicators ordered as they paint, with the candles as one more entry at
// `candleZ`. Pure and unit-tested; the renderer feeds it the scene's keys and applies the
// z it returns.

/** One layer of the stack: an indicator by id, or the candles (`id: null`). */
export interface StackEntry {
    id: string | null;
    z: number;
}

/**
 * Order the price pane's layers back to front. `indicators` comes in the scene's own
 * paint order (z, then mount order); the candles paint before an indicator sharing their
 * key, as the backends draw them.
 */
export function priceStack(indicators: readonly StackEntry[], candleZ: number): StackEntry[] {
    const out = [...indicators];
    const at = out.findIndex((e) => e.z >= candleZ);
    out.splice(at < 0 ? out.length : at, 0, { id: null, z: candleZ });
    return out;
}

/**
 * New keys that make every indicator's key distinct while keeping the paint order: the
 * entries of a run sharing one key spread out between it and the next key up (or one
 * past it at the top). The first entry of a run keeps its key, so the candles, which
 * paint first on a shared key, never move. Empty when no two layers share a key.
 */
export function untie(stack: readonly StackEntry[]): Array<{ id: string; z: number }> {
    const out: Array<{ id: string; z: number }> = [];
    for (let i = 0; i < stack.length; ) {
        let j = i + 1;
        while (j < stack.length && stack[j]!.z === stack[i]!.z) j += 1;
        const run = j - i;
        if (run > 1) {
            const base = stack[i]!.z;
            const step = ((stack[j]?.z ?? base + 1) - base) / run;
            for (let k = 1; k < run; k += 1) {
                const id = stack[i + k]!.id;
                if (id !== null) out.push({ id, z: base + k * step });
            }
        }
        i = j;
    }
    return out;
}

/** What paints directly in front of `id`: the candles, another indicator, or nothing. */
export function layerAbove(stack: readonly StackEntry[], id: string): 'price' | { indicator: string } | null {
    const i = stack.findIndex((e) => e.id === id);
    if (i < 0 || i === stack.length - 1) return null;
    const above = stack[i + 1]!;
    return above.id === null ? 'price' : { indicator: above.id };
}

/** What paints directly behind `id`: the candles, another indicator, or nothing. */
export function layerBelow(stack: readonly StackEntry[], id: string): 'price' | { indicator: string } | null {
    const i = stack.findIndex((e) => e.id === id);
    if (i <= 0) return null;
    const below = stack[i - 1]!;
    return below.id === null ? 'price' : { indicator: below.id };
}

/**
 * The z that puts `id` directly in front of the layer above it, behind whatever comes
 * next: halfway to the next key, or one past the layer above at the top of the stack.
 * Null when nothing is above. Every other layer keeps its key. Expects distinct keys
 * (see {@link untie}).
 */
export function raisedZ(stack: readonly StackEntry[], id: string): number | null {
    const i = stack.findIndex((e) => e.id === id);
    if (i < 0 || i === stack.length - 1) return null;
    const above = stack[i + 1]!;
    const next = stack[i + 2];
    return next ? (above.z + next.z) / 2 : above.z + 1;
}

/**
 * The z that puts `id` directly behind the layer below it, in front of whatever comes
 * before: halfway to the previous key, or one under the layer below at the bottom of
 * the stack. Null when nothing is below. Every other layer keeps its key. Expects
 * distinct keys (see {@link untie}).
 */
export function loweredZ(stack: readonly StackEntry[], id: string): number | null {
    const i = stack.findIndex((e) => e.id === id);
    if (i <= 0) return null;
    const below = stack[i - 1]!;
    const prev = stack[i - 2];
    return prev ? (prev.z + below.z) / 2 : below.z - 1;
}
