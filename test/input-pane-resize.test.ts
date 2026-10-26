import { describe, it, expect, vi } from 'vitest';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

/** Bare-bones event-target stand-in — enough surface for InputController.attach(). */
function fakeElement() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    return {
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
        },
        removeEventListener(type: string, fn: (e: unknown) => void) {
            listeners.get(type)?.delete(fn);
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        style: { setProperty() {} } as unknown as CSSStyleDeclaration,
        setPointerCapture() {},
        releasePointerCapture() {},
        fire(type: string, e: Record<string, unknown>) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
        },
    };
}

const SEPARATOR_Y = 120;

function harness() {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1);
    cs.setBars([1000, 2000, 3000, 4000, 5000]);
    cs.setViewport({ barSpacing: 50, rightOffset: 2 });
    const deps = {
        getCoords: () => cs,
        apply: vi.fn(),
        zoomTo: vi.fn(),
        fling: vi.fn(),
        onPointerMove: vi.fn(),
        onClick: vi.fn(),
        beginPriceScale: vi.fn(),
        priceScaleBy: vi.fn(),
        beginPricePan: () => false,
        pricePanBy: vi.fn(),
        resetPriceScale: vi.fn(),
        dataDblClick: vi.fn(),
        paneSeparatorAt: (y: number) => Math.abs(y - SEPARATOR_Y) <= 3,
        beginPaneResize: vi.fn(),
        paneResizeBy: vi.fn(),
        endPaneResize: vi.fn(),
        resetPaneSize: vi.fn(),
        resetView: vi.fn(),
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const base = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 400 };
    const press = (y: number, t = 0): void => el.fire('pointerdown', { ...base, clientY: y, timeStamp: t });
    const move = (y: number, t = 20): void => el.fire('pointermove', { ...base, clientY: y, timeStamp: t });
    return { deps, el, base, press, move };
}

describe('pane separator drag — release', () => {
    it('reports the end of a separator drag once, and never as a click', () => {
        const { deps, el, base, press, move } = harness();
        press(SEPARATOR_Y);
        move(SEPARATOR_Y + 40);
        el.fire('pointerup', { ...base, clientY: SEPARATOR_Y + 40, timeStamp: 40 });
        expect(deps.beginPaneResize).toHaveBeenCalledTimes(1);
        expect(deps.paneResizeBy).toHaveBeenLastCalledWith(40);
        expect(deps.endPaneResize).toHaveBeenCalledTimes(1);
        expect(deps.onClick).not.toHaveBeenCalled();
    });

    it('reports a cancelled separator drag too — the panes keep the sizes it reached', () => {
        const { deps, el, base, press, move } = harness();
        press(SEPARATOR_Y);
        move(SEPARATOR_Y - 30);
        el.fire('pointercancel', { ...base, clientY: SEPARATOR_Y - 30, timeStamp: 40 });
        expect(deps.endPaneResize).toHaveBeenCalledTimes(1);
    });

    it('a drag in the data area is not a pane resize', () => {
        const { deps, el, base, press, move } = harness();
        press(60);
        move(80);
        el.fire('pointerup', { ...base, clientY: 80, timeStamp: 40 });
        expect(deps.beginPaneResize).not.toHaveBeenCalled();
        expect(deps.endPaneResize).not.toHaveBeenCalled();
    });
});
