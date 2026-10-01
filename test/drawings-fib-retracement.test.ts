import { describe, it, expect, afterEach } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    resetDrawingSettings,
    FibRetracement,
    setDrawingTemplateStorage,
    ensureDrawingTemplateStorage,
    saveDrawingTemplate,
    listDrawingTemplates,
    applyDrawingTemplate,
    deleteDrawingTemplate,
    saveDefaultDrawingTemplate,
    defaultDrawingTemplate,
    clearDefaultDrawingTemplate,
    DRAWING_TEMPLATES_KEY_PREFIX,
    type DrawingTemplateStorage,
    type Projector,
    type SerializedDrawing,
} from '../src/core/drawings';

/** Linear projector: x = time, y = 100 − price, single pane 'price', 200px wide. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

/** In-memory storage that records what was written. */
function memoryStorage(): DrawingTemplateStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    };
}

const proj = fakeProjector();
// First click at price 0 (time 0), second at price 100 (time 50).
const ANCHORS = [{ time: 0, price: 0 }, { time: 50, price: 100 }];
const make = (): FibRetracement => createDrawing('fibretracement', { paneId: 'price', anchors: ANCHORS })! as FibRetracement;
const priceAt = (d: FibRetracement, ratio: number): number | undefined => d.levelLines(proj)!.find((l) => l.ratio === ratio)?.price;

/** A retracement exactly as the previous version serialized it: 7 levels, no display options. */
const LEGACY_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((ratio) => ({ ratio, color: '#787b86', enabled: true }));
function legacyDoc(): SerializedDrawing {
    return {
        id: 'dw-legacy',
        type: 'fibretracement',
        paneId: 'price',
        anchors: ANCHORS,
        style: { lineColor: '#38c0fd', lineWidth: 1, lineStyle: 'solid' },
        locked: false,
        visible: true,
        zIndex: 0,
        createdAt: 1,
        props: { levels: LEGACY_LEVELS, numbersSize: 'small', labelsSize: 'normal' },
    };
}

describe('drawings/FibRetracement orientation', () => {
    it('defaults to 1 at the first anchor and 0 at the second', () => {
        const d = make();
        expect(d.reverse).toBe(false);
        expect(priceAt(d, 1)).toBe(0);
        expect(priceAt(d, 0)).toBe(100);
        expect(priceAt(d, 0.236)).toBeCloseTo(76.4, 6);
        expect(priceAt(d, 1.618)).toBeCloseTo(-61.8, 6); // extensions project past the first anchor
    });

    it('reverse puts 0 at the first anchor (price = first + ratio·(second − first))', () => {
        const d = make();
        d.applySettings({ reverse: true });
        expect(priceAt(d, 0)).toBe(0);
        expect(priceAt(d, 1)).toBe(100);
        expect(priceAt(d, 0.618)).toBeCloseTo(61.8, 6);
        expect(d.priceRange()!.max).toBeCloseTo(423.6, 6);
    });

    it('keeps bands and hit-testing on the oriented levels', () => {
        const d = make();
        d.applySettings({ 'trendLine.visible': false });
        // 0.236 → price 76.4 → y 23.6; reversed it would sit at y 76.4.
        expect(d.hitTest(25, 23.6, proj, 1)).toBe(true);
        expect(d.hitTest(25, 76.4, proj, 1)).toBe(false);
        const bands = d.fillBands(proj);
        expect(bands[0]!.y).toBeCloseTo(0, 6); // 0 (y 0) → 0.236 (y 23.6)
        expect(bands[0]!.h).toBeCloseTo(23.6, 6);
    });
});

describe('drawings/FibRetracement back-compat', () => {
    it('reads a record without the new keys exactly as it painted before', () => {
        const d = deserializeDrawing(legacyDoc()) as FibRetracement;
        expect(d.reverse).toBe(true);
        expect(d.levels.map((l) => l.ratio)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]); // saved levels kept
        expect(d.priceRange()).toEqual({ min: 0, max: 100 });
        expect(d.trendSegment(proj)).toBeNull();
        const e = d.entryLines(proj)!.find((l) => l.y1 === 100 - 61.8)!;
        // The previous geometry: "<ratio> (<price>)" inside the left end, 7px above the line.
        expect(e.numberText).toBe('0.618 (61.80)');
        expect(e.numberX).toBe(4);
        expect(e.numberY).toBeCloseTo(100 - 61.8 - 7, 9);
        expect(e.numberAlign).toBe('left');
        expect(e.labelY).toBeCloseTo(100 - 61.8 - 7, 9);
        expect(d.fillBands(proj).every((b) => Math.abs(b.opacity! - 0.06) < 1e-9)).toBe(true); // the painter's old fixed alpha
        expect(d.timeExtent()).toEqual({ min: 0, max: 50 });
    });

    it('a legacy record stays legacy through a save/load round-trip', () => {
        const doc = deserializeDrawing(legacyDoc())!.serialize();
        expect(doc.props!.reverse).toBe(true);
        const again = deserializeDrawing(doc) as FibRetracement;
        expect(again.reverse).toBe(true);
        expect(again.serialize()).toEqual(doc);
    });

    it('a partial props patch on a live drawing never flips its orientation', () => {
        const d = make();
        d.applyProps({ numbersSize: 'large' });
        expect(d.reverse).toBe(false);
        const old = deserializeDrawing(legacyDoc())!;
        old.applyProps({ levels: LEGACY_LEVELS });
        expect((old as FibRetracement).reverse).toBe(true);
    });
});

describe('drawings/FibRetracement display options', () => {
    it('new drawings get the default option set', () => {
        const d = make();
        expect(d.trendLine).toEqual({ visible: true, color: '#787b86', width: 1, style: 'dashed' });
        expect([d.extendLeft, d.extendRight, d.showPrices, d.showLevels, d.levelsFormat]).toEqual([false, false, true, true, 'values']);
        expect([d.labelsH, d.labelsV]).toEqual(['left', 'middle']);
        expect([d.fillBackground, d.backgroundTransparency, d.useOneColor]).toEqual([true, 80, false]);
    });

    it('every option round-trips through serialize', () => {
        const d = make();
        d.applySettings({
            reverse: true,
            'trendLine.visible': false,
            'trendLine.color': '#ff0000',
            'trendLine.width': 3,
            'trendLine.style': 'dotted',
            extendLeft: true,
            extendRight: true,
            showPrices: false,
            showLevels: true,
            levelsFormat: 'percents',
            labelsH: 'right',
            labelsV: 'bottom',
            fillBackground: false,
            backgroundTransparency: 40,
            useOneColor: true,
            oneColor: '#00ff00',
        });
        const doc = d.serialize();
        const back = deserializeDrawing(doc) as FibRetracement;
        expect(back.serialize()).toEqual(doc);
        expect(back.reverse).toBe(true);
        expect(back.trendLine).toEqual({ visible: false, color: '#ff0000', width: 3, style: 'dotted' });
        expect([back.extendLeft, back.extendRight, back.showPrices, back.levelsFormat]).toEqual([true, true, false, 'percents']);
        expect([back.labelsH, back.labelsV, back.fillBackground, back.backgroundTransparency]).toEqual(['right', 'bottom', false, 40]);
        expect([back.useOneColor, back.oneColor]).toEqual([true, '#00ff00']);
    });

    it('ignores malformed option values in props', () => {
        const doc = make().serialize();
        doc.props = { ...doc.props, labelsH: 'diagonal', backgroundTransparency: 'x', trendLine: { width: -1, style: 'wavy' } };
        const d = deserializeDrawing(doc) as FibRetracement;
        expect(d.labelsH).toBe('left');
        expect(d.backgroundTransparency).toBe(80);
        expect(d.trendLine.width).toBe(1);
        expect(d.trendLine.style).toBe('dashed');
    });

    it('prices / levels text and its format', () => {
        const d = make();
        const at = (ratio: number): string => d.entryLines(proj)!.find((l) => Math.abs(l.y1 - (100 - (100 - ratio * 100))) < 1e-9)!.numberText;
        expect(at(0.5)).toBe('0.5 (50.00)');
        d.applySettings({ levelsFormat: 'percents' });
        expect(at(0.618)).toBe('61.8% (38.20)');
        d.applySettings({ showPrices: false });
        expect(at(0.618)).toBe('61.8%');
        d.applySettings({ showLevels: false, showPrices: true });
        expect(at(0.618)).toBe('38.20');
        d.applySettings({ showPrices: false });
        expect(at(0.618)).toBe('');
    });

    it('labels position: horizontal × vertical', () => {
        const d = make();
        const first = () => d.entryLines(proj)![0]!; // level 0 at y 0, x 0..50
        expect(first()).toMatchObject({ numberX: -4, numberY: 0, numberAlign: 'right' }); // left/middle → just outside
        d.applySettings({ labelsH: 'right' });
        expect(first()).toMatchObject({ numberX: 54, numberAlign: 'left' });
        d.applySettings({ labelsV: 'top' });
        expect(first()).toMatchObject({ numberX: 46, numberY: -7, numberAlign: 'right' }); // above → tucked inside
        d.applySettings({ labelsH: 'center', labelsV: 'bottom' });
        expect(first()).toMatchObject({ numberX: 25, numberY: 7, numberAlign: 'center' });
    });

    it('extend lines reach the pane edges, widen culling, and drive hit-testing', () => {
        const d = make();
        expect(d.hitTest(150, 50, proj, 2)).toBe(false);
        d.applySettings({ extendRight: true });
        expect(d.entryLines(proj)![0]).toMatchObject({ x1: 0, x2: 200 });
        expect(d.hitTest(150, 50, proj, 2)).toBe(true);
        expect(d.timeExtent()).toEqual({ min: 0, max: Number.POSITIVE_INFINITY });
        d.applySettings({ extendLeft: true });
        expect(d.timeExtent()!.min).toBe(Number.NEGATIVE_INFINITY);
        expect(d.fillBands(proj)[0]!.w).toBe(200);
    });

    it('background toggle + transparency and the single color', () => {
        const d = make();
        expect(d.fillBands(proj)[0]!.opacity).toBeCloseTo(0.2, 9);
        d.applySettings({ backgroundTransparency: 50 });
        expect(d.fillBands(proj)[0]!.opacity).toBeCloseTo(0.5, 9);
        d.applySettings({ fillBackground: false });
        expect(d.fillBands(proj)).toEqual([]);
        d.applySettings({ useOneColor: true, oneColor: '#123456' });
        expect(d.entryLines(proj)!.every((l) => l.color === '#123456')).toBe(true);
        d.applySettings({ useOneColor: false });
        expect(new Set(d.entryLines(proj)!.map((l) => l.color)).size).toBeGreaterThan(1);
    });

    it('trend line joins the anchors, is hit-testable, and can be hidden', () => {
        const d = make();
        expect(d.trendSegment(proj)).toEqual({ x1: 0, y1: 100, x2: 50, y2: 0, color: '#787b86', width: 1, style: 'dashed' });
        expect(d.hitTest(12.5, 75, proj, 2)).toBe(true); // on the diagonal, off every level
        d.applySettings({ 'trendLine.visible': false });
        expect(d.trendSegment(proj)).toBeNull();
        expect(d.hitTest(12.5, 75, proj, 2)).toBe(false);
    });

    it('levels can be added and removed (whole-array patch) and persist', () => {
        const d = make();
        d.applySettings({ levels: [...d.levels, { ratio: -0.272, color: '#abcdef', enabled: true }] });
        expect(priceAt(d, -0.272)).toBeCloseTo(127.2, 6);
        d.applySettings({ levels: d.levels.filter((l) => l.ratio !== 0.5) });
        const back = deserializeDrawing(d.serialize()) as FibRetracement;
        expect(back.levels.map((l) => l.ratio)).toEqual([0, 0.236, 0.382, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236, -0.272]);
    });
});

describe('drawing templates', () => {
    afterEach(() => setDrawingTemplateStorage(undefined));

    it('save / list / apply / delete a named template — cosmetics only, never anchors', () => {
        const store = memoryStorage();
        setDrawingTemplateStorage(store);
        const src = make();
        src.applySettings({ reverse: true, useOneColor: true, oneColor: '#00ff00', 'style.lineWidth': 3, levels: src.levels.slice(0, 3) });
        expect(saveDrawingTemplate(src, '  Mine  ')!.name).toBe('Mine');
        expect(listDrawingTemplates('fibretracement').map((t) => t.name)).toEqual(['Mine']);
        expect(store.data.has(`${DRAWING_TEMPLATES_KEY_PREFIX}fibretracement`)).toBe(true);

        const dst = createDrawing('fibretracement', { paneId: 'price', anchors: [{ time: 5, price: 10 }, { time: 9, price: 20 }] })! as FibRetracement;
        expect(applyDrawingTemplate(dst, 'Mine')).toBe(true);
        expect(dst.anchors).toEqual([{ time: 5, price: 10 }, { time: 9, price: 20 }]);
        expect([dst.reverse, dst.useOneColor, dst.oneColor, dst.style.lineWidth]).toEqual([true, true, '#00ff00', 3]);
        expect(dst.levels.length).toBe(3);
        expect(applyDrawingTemplate(dst, 'nope')).toBe(false);

        // Re-reading from storage (fresh cache) sees the same template.
        setDrawingTemplateStorage(store);
        expect(listDrawingTemplates('fibretracement')[0]!.props!.oneColor).toBe('#00ff00');
        expect(deleteDrawingTemplate('fibretracement', 'Mine')).toBe(true);
        expect(listDrawingTemplates('fibretracement')).toEqual([]);
        expect(store.data.size).toBe(0);
    });

    it('a saved default seeds new drawings of its type; factory reset ignores it', () => {
        setDrawingTemplateStorage(memoryStorage());
        const src = make();
        src.applySettings({ labelsH: 'right', 'style.lineStyle': 'dotted', levels: src.levels.slice(0, 2) });
        saveDefaultDrawingTemplate(src);
        expect(defaultDrawingTemplate('fibretracement')).toBeDefined();

        const fresh = make();
        expect(fresh.labelsH).toBe('right');
        expect(fresh.style.lineStyle).toBe('dotted');
        expect(fresh.levels.length).toBe(2);
        expect(fresh.reverse).toBe(false); // the template carries its own (new-default) orientation
        // An explicit caller override still wins over the template.
        const over = createDrawing('fibretracement', { paneId: 'price', anchors: ANCHORS, style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' } })!;
        expect(over.style.lineStyle).toBe('solid');
        // Other types are unaffected.
        expect(createDrawing('fibextension', { paneId: 'price', anchors: ANCHORS })!.style.lineStyle).toBe('solid');
        // Persisted drawings are restored as saved, not re-templated.
        const restored = deserializeDrawing(legacyDoc()) as FibRetracement;
        expect(restored.labelsH).toBe('left');

        resetDrawingSettings(fresh);
        expect(fresh.labelsH).toBe('left');
        expect(fresh.levels.length).toBe(11);

        clearDefaultDrawingTemplate('fibretracement');
        expect(make().labelsH).toBe('left');
    });

    it('degrades silently on a missing, corrupt, or throwing store', () => {
        setDrawingTemplateStorage(null);
        expect(saveDrawingTemplate(make(), 'mem')).not.toBeNull(); // memory only
        expect(listDrawingTemplates('fibretracement').length).toBe(1);

        const corrupt = memoryStorage();
        corrupt.data.set(`${DRAWING_TEMPLATES_KEY_PREFIX}fibretracement`, '{not json');
        setDrawingTemplateStorage(corrupt);
        expect(listDrawingTemplates('fibretracement')).toEqual([]);
        expect(make().levels.length).toBe(11);

        const boom: DrawingTemplateStorage = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('quota'); },
            removeItem: () => { throw new Error('denied'); },
        };
        setDrawingTemplateStorage(boom);
        expect(() => saveDefaultDrawingTemplate(make())).not.toThrow();
        expect(() => make()).not.toThrow();
    });

    it('ensureDrawingTemplateStorage never replaces a host-installed store', () => {
        const host = memoryStorage();
        setDrawingTemplateStorage(host);
        ensureDrawingTemplateStorage(memoryStorage());
        saveDrawingTemplate(make(), 'x');
        expect(host.data.size).toBe(1);
    });
});
