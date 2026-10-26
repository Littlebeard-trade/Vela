import { describe, it, expect } from 'vitest';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';

describe('scene graph — pane height weights', () => {
    it('gives new panes the default weights: 3 for the price pane, 1 for a study pane', () => {
        const scene = new SceneGraph();
        expect(scene.ensurePane('price', 'price', 0).heightWeight).toBe(3);
        expect(scene.ensurePane('pane-a', 'study', 1).heightWeight).toBe(1);
        expect(scene.ensurePane('pane-b', 'study', 2, 4).heightWeight).toBe(4);
    });

    it('keeps a pane weight when the pane is ensured again without one', () => {
        const scene = new SceneGraph();
        scene.ensurePane('price', 'price', 0);
        scene.ensurePane('pane-a', 'study', 1);
        // A user drag or chart.panes.setHeightWeight writes the weight on the node.
        scene.panes.get('price')!.heightWeight = 8;
        scene.panes.get('pane-a')!.heightWeight = 2;

        // What the renderer does whenever another indicator mounts onto these panes.
        scene.ensurePane('price', 'price', 0);
        scene.ensurePane('pane-a', 'study', 2);
        expect(scene.panes.get('price')!.heightWeight).toBe(8);
        expect(scene.panes.get('pane-a')!.heightWeight).toBe(2);
        expect(scene.panes.get('pane-a')!.order).toBe(2);

        // An explicit weight still replaces it.
        scene.ensurePane('pane-a', 'study', 2, 5);
        expect(scene.panes.get('pane-a')!.heightWeight).toBe(5);
    });
});
