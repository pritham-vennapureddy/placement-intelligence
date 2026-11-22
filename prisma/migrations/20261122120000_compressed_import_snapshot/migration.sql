-- Import snapshots stored gzipped (about 5x smaller than JSON, so far quicker to load).
ALTER TABLE "ImportBatch" ADD COLUMN "sourceSnapshotGz" BYTEA;
