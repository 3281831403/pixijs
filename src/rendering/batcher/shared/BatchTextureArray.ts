import type { TextureSource } from '../../renderers/shared/texture/sources/TextureSource';

/**
 * Used by the batcher to build texture batches. Holds list of textures and their respective locations.
 * @category rendering
 * @advanced
 */
export class BatchTextureArray
{
    /** Inside textures array. */
    public textures: TextureSource[];

    /** Respective locations for textures. */
    public ids: Record<number, number> = Object.create(null);

    /** Number of filled elements. */
    public count: number;

    constructor()
    {
        this.textures = [];
        this.count = 0;
    }

    /** Clear the textures and their locations. */
    public clear(): void
    {
        const ids = this.ids;

        for (let i = 0; i < this.count; i++)
        {
            const t = this.textures[i];

            this.textures[i] = null;

            // delete the key rather than null it: the table is reused by a pooled batch, and
            // nulled entries would accumulate one key per texture the batch ever held
            delete ids[t.uid];
        }

        this.count = 0;
    }
}
