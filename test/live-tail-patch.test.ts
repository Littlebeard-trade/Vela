// Live tail patches: tailModelToValuePatch builds O(tail) patches from a merged model,
// and applyPatch merges them (drop ≥ from, append) instead of replacing — idempotently,
// so a patch whose arrays the renderer model aliases cannot double-append. The full
// (non-tail) patch now also snapshots fills/backgrounds/priceLines/barColors, which the
// live path historically left stale.
import { describe, expect, it } from 'vitest';
import type { IndicatorModel } from '../src/core/model';
import { modelToValuePatch, tailModelToValuePatch } from '../src/core/engine/EngineOrchestrator';
import { applyPatch } from '../src/renderers/native/NativeRenderer';

const line = (id: string, pts: Array<[number, number | null]>) =>
    ({ id, kind: 'line', title: id, points: pts.map(([time, value]) => ({ time, value })) }) as never;

const model = (over?: Partial<IndicatorModel>): IndicatorModel => ({
    id: 'i1', title: 'T', overlay: false, paneHint: 'new',
    series: [line('s1', [[1000, 1], [2000, 2], [3000, 3]]), line('s2', [[1000, 9], [2000, 8], [3000, 7]])],
    fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
    ...over,
});

describe('tailModelToValuePatch', () => {
    it('slices each series from the end at `from` and marks the patch tail', () => {
        const p = tailModelToValuePatch(model(), 3000);
        expect(p.tail).toBe(true);
        expect(p.dirty).toEqual({ from: 3000, to: 3000 });
        expect(p.series).toEqual([
            { seriesId: 's1', kind: 'points', points: [{ time: 3000, value: 3 }] },
            { seriesId: 's2', kind: 'points', points: [{ time: 3000, value: 7 }] },
        ]);
    });

    it('an all-na tail (no points at/after from) still patches: empty delta drops the stale tail', () => {
        const p = tailModelToValuePatch(model({ series: [line('s1', [[1000, 1], [2000, 2]])] }), 3000);
        expect(p.series).toEqual([{ seriesId: 's1', kind: 'points', points: [] }]);
    });

    it('carries the snapshot collections', () => {
        const m = model({ backgrounds: [{ id: 'b', paneId: 'p', from: 1, to: 2, color: '#123456' }], barColors: [{ time: 3000, color: '#fff' }] });
        const p = tailModelToValuePatch(m, 3000);
        expect(p.backgrounds).toBe(m.backgrounds);
        expect(p.barColors).toBe(m.barColors);
    });
});

describe('applyPatch tail merge', () => {
    it('drops entries ≥ from and appends the delta points', () => {
        const target = model();
        const merged = model({ series: [line('s1', [[1000, 1], [2000, 2], [3000, 30], [4000, 40]]), line('s2', [[1000, 9], [2000, 8], [3000, 7]])] });
        applyPatch(target, tailModelToValuePatch(merged, 3000));
        expect((target.series[0] as never as { points: unknown }).points).toEqual([
            { time: 1000, value: 1 }, { time: 2000, value: 2 }, { time: 3000, value: 30 }, { time: 4000, value: 40 },
        ]);
        expect((target.series[1] as never as { points: unknown }).points).toEqual([
            { time: 1000, value: 9 }, { time: 2000, value: 8 }, { time: 3000, value: 7 },
        ]);
    });

    it('is idempotent: applying the same tail patch twice equals once', () => {
        const target = model();
        const merged = model({ series: [line('s1', [[1000, 1], [2000, 2], [3000, 30], [4000, 40]]), line('s2', [[1000, 9], [2000, 8], [3000, 7], [4000, 6]])] });
        const p = tailModelToValuePatch(merged, 3000);
        applyPatch(target, p);
        const once = JSON.parse(JSON.stringify(target.series));
        applyPatch(target, p);
        expect(JSON.parse(JSON.stringify(target.series))).toEqual(once);
    });

    it('a value going na removes the stale point (empty delta for that series)', () => {
        const target = model();
        const merged = model({ series: [line('s1', [[1000, 1], [2000, 2]]), line('s2', [[1000, 9], [2000, 8], [3000, 7]])] });
        applyPatch(target, tailModelToValuePatch(merged, 3000));
        expect((target.series[0] as never as { points: { length: number } }).points.length).toBe(2);
    });

    it('aliased arrays (renderer model IS the merged model) are left as merged, not doubled', () => {
        const m = model();
        applyPatch(m, tailModelToValuePatch(m, 3000)); // patch slices from m itself → delta aliases? slice copies — simulate direct alias:
        expect((m.series[0] as never as { points: { length: number } }).points.length).toBe(3);
        const p = tailModelToValuePatch(m, 3000);
        (p.series[0] as never as { points: unknown }).points = (m.series[0] as never as { points: unknown }).points; // force alias
        applyPatch(m, p);
        expect((m.series[0] as never as { points: { length: number } }).points.length).toBe(3);
    });

    it('full (non-tail) patches now refresh the snapshot collections', () => {
        const target = model();
        const next = model({ backgrounds: [{ id: 'b', paneId: 'p', from: 1, to: 2, color: '#123456' }], barColors: [{ time: 3000, color: '#fff' }] });
        applyPatch(target, modelToValuePatch(next));
        expect(target.backgrounds).toEqual(next.backgrounds);
        expect(target.barColors).toEqual(next.barColors);
    });
});
