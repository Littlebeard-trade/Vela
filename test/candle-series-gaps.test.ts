// A candle/bar series is index-aligned to the bars its indicator ran over, so a bar it has
// no candle for is an EMPTY SLOT in `bars` (Pine's `show_last` window leaves them before the
// window; a host engine may leave them anywhere). The first paint mounts the series whole and
// skipped them, but every later update (a live tick, a re-run, a replay step) read a time off
// each entry and threw on the first gap, and so did the renderer's anchor-offset search.
import { describe, it, expect, vi } from 'vitest';
import { Vela } from '../src/index';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { VelaTheme } from '../src/core/options';
import type { IChartRenderer, RendererCapabilities, IndicatorRenderHandle, CrosshairEvent, ClickEvent, VisibleRange } from '../src/core/ports/IChartRenderer';
import type { ScriptingEngine, EngineCapabilities, PreparedScript, ExecutionRequest, ExecutionHandlers, ExecutionSession } from '../src/core/ports/ScriptingEngine';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { CandleSeries } from '../src/core/model/series';
import type { ScenePatch, ValuePatch } from '../src/core/model/patch';
import type { Unsubscribe } from '../src/core/util/types';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const bar = (i: number): OHLCV => ({ time: T0 + i * HOUR, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1 });

/** Bars 0..n-1 with the given indices left as empty slots. */
function gapped(n: number, gaps: number[]): OHLCV[] {
    const out = new Array<OHLCV>(n);
    for (let i = 0; i < n; i += 1) if (!gaps.includes(i)) out[i] = bar(i);
    return out;
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

class Feed implements MarketDataFeed {
    load(): Promise<OHLCV[]> { return Promise.resolve(Array.from({ length: 10 }, (_, i) => bar(i))); }
    subscribe(): Unsubscribe { return () => {}; }
}

/** Records what the orchestrator hands the renderer. */
class RecordingRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native',
        markers: true, barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'recording';
    readonly features: readonly string[] = [];
    patches: ScenePatch[] = [];
    mount(): void {}
    setTheme(): void {}
    resize(): void {}
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    destroy(): void {}
    setBars(): void {}
    updateBar(): void {}
    ensurePane(): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, p: ScenePatch): void { this.patches.push(p); }
    removeIndicator(): void {}
    setIndicatorInputs(): void {}
    setIndicatorVisible(): void {}
    setIndicatorStatus(): void {}
    onInputChange(): Unsubscribe { return () => {}; }
    onRemoveIndicator(): Unsubscribe { return () => {}; }
    onToggleIndicatorVisible(): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(): void {}
    onViewportChange(): Unsubscribe { return () => {}; }
}

/** Emits an overlay candle series with gaps twice: the mount, then a value update. */
class GappedCandleEngine implements ScriptingEngine {
    readonly language = 'gaps';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: false, inputs: true };
    prepare(_source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve({ language: 'gaps', inputs: [], meta: { title: 'Gaps', overlay: true }, reactsToViewport: false, token: instanceId });
    }
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const id = req.prepared.token as string;
        const emit = (): void => {
            const candles: CandleSeries = { id: `${id}:candle`, title: 'Gaps', paneId: 'unrouted', kind: 'candle', bars: gapped(10, [0, 4, 9]) };
            handlers.onModel({ id, title: 'Gaps', overlay: true, paneHint: 'price', series: [candles], fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {} });
            handlers.onDone?.();
        };
        emit();
        emit();
        return { stop: () => {}, update: () => emit(), setVisibleRange: () => {}, notifyBars: () => {} };
    }
}

describe('candle series with empty slots', () => {
    it('updates without throwing, keeps the slots, and reports the span of the real candles', async () => {
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [new GappedCandleEngine()], dataFeed: new Feed() });
        await chart.ready();
        const failed = vi.fn();
        chart.on('indicator:error', failed);
        chart.addIndicator('gapped', { language: 'gaps' });
        await flush();

        expect(failed).not.toHaveBeenCalled();
        const update = renderer.patches.find((p): p is ValuePatch => p.kind === 'value');
        expect(update).toBeDefined();
        const delta = update!.series[0]!;
        expect(delta.kind).toBe('bars');
        const sent = delta.kind === 'bars' ? delta.bars : [];
        expect(sent).toHaveLength(10);
        expect(0 in sent).toBe(false);
        expect(sent[5]).toEqual(bar(5));
        expect(update!.dirty).toEqual({ from: T0 + 1 * HOUR, to: T0 + 8 * HOUR });
        chart.destroy();
    });
});

describe('canvas2d — a candle series draws nothing for a gap', () => {
    it('skips an empty slot and an entry with NaN prices, and keeps the others on their bars', () => {
        const SERIES_COLOR = '#abcdef';
        const ops: Array<{ op: string; style: string }> = [];
        const state = { fillStyle: '', strokeStyle: '' };
        const noop = (): void => undefined;
        const ctx = {
            set fillStyle(v: string) { state.fillStyle = v; },
            get fillStyle() { return state.fillStyle; },
            set strokeStyle(v: string) { state.strokeStyle = v; },
            get strokeStyle() { return state.strokeStyle; },
            globalAlpha: 1, lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
            setTransform: noop, clearRect: noop, save: noop, restore: noop,
            beginPath: noop, closePath: noop, rect: noop, clip: noop,
            moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, setLineDash: noop,
            fill: () => ops.push({ op: 'fill', style: state.fillStyle }),
            stroke: () => ops.push({ op: 'stroke', style: state.strokeStyle }),
            fillRect: () => ops.push({ op: 'fill', style: state.fillStyle }),
            strokeRect: () => ops.push({ op: 'stroke', style: state.strokeStyle }),
            createLinearGradient: () => ({ addColorStop: noop }),
        } as unknown as CanvasRenderingContext2D;
        const backend = new Canvas2dBackend();
        backend.mount({ width: 400, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement);

        const chartBars = [0, 1, 2, 3].map(bar);
        const scene = new SceneGraph();
        scene.bars = chartBars;
        scene.showGrid = false;
        const pane = scene.ensurePane('price', 'price', 0);
        pane.bounds = { top: 0, height: 100 };
        pane.scale = { min: 95, max: 110 };
        const nan: OHLCV = { time: bar(1).time, open: Number.NaN, high: Number.NaN, low: Number.NaN, close: Number.NaN };
        const seriesBars = gapped(4, [2]);
        seriesBars[1] = nan;
        const model: IndicatorModel = {
            id: 'm', title: 'M', overlay: true, paneHint: 'price', paneId: 'price',
            series: [{ id: 'm:candle', title: 'M', paneId: 'price', kind: 'candle', bars: seriesBars, style: { up: SERIES_COLOR, down: SERIES_COLOR } }],
            fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
        };
        scene.indicators.set(model.id, model);
        scene.assignIndicatorZ(model.id);

        const coords = new CoordinateSystem();
        coords.setSize(400, 100, 1);
        coords.setBars(chartBars.map((b) => b.time));
        backend.render(scene, coords, { background: '#000', textColor: '#ccc', gridColor: '#222', borderColor: '#333', upColor: '#0a0', downColor: '#a00', fontFamily: 'sans-serif' } as VelaTheme);

        // Bars 0 and 3 only: a wick stroke and a body fill each.
        expect(ops.filter((o) => o.style === SERIES_COLOR)).toHaveLength(4);
    });
});

describe('native renderer — anchor offset over a candle series with empty slots', () => {
    it('counts the slots before the chart head, gaps included', () => {
        const r = new NativeRenderer();
        const internals = r as unknown as { scene: SceneGraph; scheduler: { invalidate(): void }; bars: OHLCV[] };
        internals.scheduler = { invalidate: () => {} }; // unmounted: there is no frame to schedule
        // The chart now starts at bar 5; the model ran over bars 0..9.
        internals.bars = Array.from({ length: 5 }, (_, i) => bar(5 + i));
        const candles: CandleSeries = { id: 'm:candle', title: 'M', paneId: 'price', kind: 'candle', bars: gapped(10, [5]) };
        internals.scene.indicators.set('m', { id: 'm', title: 'M', overlay: true, paneHint: 'price', paneId: 'price', series: [candles], fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {} });

        // The slot the search lands on first (index 5) is the gap.
        const patch: ValuePatch = { kind: 'value', indicatorId: 'm', dirty: { from: T0, to: T0 + 9 * HOUR }, anchorTime: T0, series: [{ seriesId: 'm:candle', kind: 'bars', bars: gapped(10, [5]) }] };
        r.updateIndicator({ id: 'm' }, patch);

        expect(internals.scene.offsetOf('m')).toBe(-5);
    });
});
