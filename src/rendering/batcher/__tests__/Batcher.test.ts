import '~/rendering/renderers/shared/texture/sources/ImageSource';
import { DummyBatchableObject } from './DummyBatchableObject';
import { TestBatcher } from './TestBatcher';
import { getTexture } from '@test-utils';
import { InstructionSet } from '~/rendering';

import type { Batch, BLEND_MODES, Texture } from '~/rendering';

function makeElement(texture: Texture, blendMode: BLEND_MODES = 'normal'): DummyBatchableObject
{
    const element = new DummyBatchableObject();

    element.texture = texture;
    element.blendMode = blendMode;

    return element;
}

function makeElements(textures: Texture[]): DummyBatchableObject[]
{
    return textures.map((texture) => makeElement(texture));
}

/**
 * Texture source uids of each batch, in order.
 * @param batcher - batcher after `finish`
 */
function batchTextureUids(batcher: TestBatcher): number[][]
{
    return batcher.batches.slice(0, batcher.batchIndex).map((batch) =>
        batch.textures.textures.slice(0, batch.textures.count).map((source) => source.uid));
}

function buildBatches(maxTextures: number, elements: DummyBatchableObject[]): number[][]
{
    const batcher = new TestBatcher({ maxTextures });

    batcher.begin();
    elements.forEach((element) => batcher.add(element));
    batcher.finish(new InstructionSet());

    return batchTextureUids(batcher);
}

describe('Batcher', () =>
{
    it('should ensure attribute size and resize correctly', () =>
    {
        const batcher = new TestBatcher({
            maxTextures: 16,
            attributesInitialSize: 2 * 6,
            indicesInitialSize: 1,
        });

        expect(batcher.attributeBuffer.float32View).toHaveLength(2 * 6);

        batcher.ensureAttributeBuffer(30);

        expect(batcher.attributeBuffer.float32View).toHaveLength(30);

        batcher.ensureAttributeBuffer(34);

        const ref = batcher.attributeBuffer;

        expect(batcher.attributeBuffer.float32View).toHaveLength(60);

        batcher.ensureAttributeBuffer(36);

        expect(batcher.attributeBuffer.float32View).toHaveLength(60);

        expect(batcher.attributeBuffer).toBe(ref);
    });

    it('should ensure index size and resize correctly', () =>
    {
        const batcher = new TestBatcher({
            maxTextures: 16,
            attributesInitialSize: 2 * 6,
            indicesInitialSize: 2,
        });

        expect(batcher.indexBuffer).toHaveLength(2);
        // disable until i get to the bottom of uint 16 vs uint 32
        expect(batcher.indexBuffer.BYTES_PER_ELEMENT).toBe(2);

        batcher.ensureIndexBuffer(30);

        expect(batcher.indexBuffer).toHaveLength(30);

        batcher.ensureIndexBuffer(34);

        const ref = batcher.indexBuffer;

        expect(batcher.indexBuffer).toHaveLength(46);

        batcher.ensureIndexBuffer(36);

        expect(batcher.indexBuffer).toHaveLength(46);
        // disable until i get to the bottom of uint 16 vs uint 32
        // expect(batcher.indexBuffer.BYTES_PER_ELEMENT).toBe(2);

        expect(batcher.indexBuffer).toBe(ref);

        batcher.ensureIndexBuffer(70000);

        expect(batcher.indexBuffer).toHaveLength(70000);
        // disable until i get to the bottom of uint 16 vs uint 32
        // expect(batcher.indexBuffer.BYTES_PER_ELEMENT).toBe(4);
    });

    it('should reuse the texture slot of a source that opened a batch after a texture count flush', () =>
    {
        const [a, b, c] = [getTexture(), getTexture(), getTexture()];
        const elements = makeElements([a, b, c, c, c]);

        const batches = buildBatches(2, elements);

        expect(batches).toEqual([[a.source.uid, b.source.uid], [c.source.uid]]);
        expect(elements.map((element) => element._textureId)).toEqual([0, 1, 0, 0, 0]);
    });

    it('should reuse the texture slot of a source that opened a batch after a blend mode flush', () =>
    {
        const a = getTexture();
        const elements = [makeElement(a, 'normal'), makeElement(a, 'add'), makeElement(a, 'add')];

        const batches = buildBatches(16, elements);

        expect(batches).toEqual([[a.source.uid], [a.source.uid]]);
    });

    it('should not break the batch for every element with a single texture slot', () =>
    {
        const [a, b] = [getTexture(), getTexture()];
        const elements = makeElements([a, b, b, b]);

        const batches = buildBatches(1, elements);

        expect(batches).toEqual([[a.source.uid], [b.source.uid]]);
    });

    it('should release textures, ids and bind groups back to the pool over 120 reused frames', () =>
    {
        const maxTextures = 2;
        const batcher = new TestBatcher({ maxTextures });
        const textures = [getTexture(), getTexture(), getTexture()];

        // the GPU adaptor attaches bind groups to a batch while executing it; mimic that here
        const fakeBindGroup = { fake: 'bindGroup' } as unknown as Batch['bindGroup'];
        const fakeGpuBindGroup = { fake: 'gpuBindGroup' } as unknown as Batch['gpuBindGroup'];

        const seenBatches = new Set<Batch>();
        let firstFrameBatches: Batch[] = null;

        for (let frame = 0; frame < 120; frame++)
        {
            const previousBatchCount = batcher.batchIndex;

            batcher.begin();

            // begin() has returned last frame's batches to the pool: none of them may keep
            // the textures, the id table or the bind groups that stop the sources from being GC'd
            for (let i = 0; i < previousBatchCount; i++)
            {
                const pooled = batcher.batches[i];

                expect(pooled.textures.count).toBe(0);
                expect(pooled.textures.textures.some((source) => source)).toBeFalse();
                expect(Object.keys(pooled.textures.ids)).toHaveLength(0);
                expect(pooled.bindGroup).toBeNull();
                expect(pooled.gpuBindGroup).toBeNull();
                expect(pooled.elements).toBeNull();
            }

            const elements = makeElements(textures);

            elements.forEach((element) => batcher.add(element));
            batcher.finish(new InstructionSet());

            const batches = batcher.batches.slice(0, batcher.batchIndex);

            // three textures with two slots always make two batches
            expect(batches).toHaveLength(2);

            // the first texture of the reused batch still binds at location 0
            expect(elements[0]._textureId).toBe(0);
            expect(batches[0].textures.ids[textures[0].source.uid]).toBe(0);

            // a reused batch's id table only holds the textures it currently draws
            expect(Object.keys(batches[0].textures.ids)).toHaveLength(2);
            expect(Object.keys(batches[1].textures.ids)).toHaveLength(1);

            batches.forEach((batch) =>
            {
                batch.bindGroup = fakeBindGroup;
                batch.gpuBindGroup = fakeGpuBindGroup;
                seenBatches.add(batch);
            });

            if (frame === 0)
            {
                firstFrameBatches = batches;
            }
            else
            {
                for (const batch of batches) expect(firstFrameBatches).toContain(batch);
            }
        }

        // no new Batch objects at all across the run
        expect(seenBatches.size).toBe(2);
    });
});
