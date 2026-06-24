# Migrating from the 2-node cluster to a single node on bowmore

Collapse the cluster onto **one all-roles ES node on bowmore** and retire kilchoman.
This uses **snapshot & restore** (Path A) so the precomputed vectors travel with the
index — both the dense `embedding` and the ELSER sparse vectors in the `semantic`
field. That's the whole point: you skip the slow ELSER re-embed that a fresh
`npm run ingest` would force (50 docs/bulk, in-cluster ELSER inference).

Both nodes are Elasticsearch 8.17.1, so the snapshot is version-clean.

## 0. Prereqs (one-time)

Create the snapshot host dir on **both** machines (the compose files mount it at `/snapshots`):

```bash
# on kilchoman (192.168.68.56) AND on bowmore (192.168.68.51)
mkdir -p /home/ben/es-snap
# ES runs as uid 1000 inside the container; make sure it can write:
sudo chown -R 1000:1000 /home/ben/es-snap
```

The `path.repo=/snapshots` + `/home/ben/es-snap:/snapshots` mount is already wired into
`deploy/kilchoman/docker-compose.yml` and `deploy/bowmore-single/docker-compose.yml`.
If kilchoman is already running the old compose, recreate it once to pick up the new mount:

```bash
# on kilchoman, in the dir holding its docker-compose.yml
docker compose up -d --force-recreate
```

## 1. Snapshot `jobs` on kilchoman (source)

```bash
# register the fs repo
curl -X PUT 192.168.68.56:9200/_snapshot/migrate \
  -H 'content-type: application/json' \
  -d '{"type":"fs","settings":{"location":"/snapshots"}}'

# snapshot just the jobs index (no global cluster state)
curl -X PUT '192.168.68.56:9200/_snapshot/migrate/jobs-1?wait_for_completion=true' \
  -H 'content-type: application/json' \
  -d '{"indices":"jobs","include_global_state":false}'
```

Expect `"state":"SUCCESS"` in the response.

## 2. Move the snapshot files to bowmore

```bash
# run on bowmore (pulls from kilchoman)
rsync -av --delete 192.168.68.56:/home/ben/es-snap/ /home/ben/es-snap/
```

## 3. Bring up the single node on bowmore (target)

First make sure the **old** bowmore ml node is down (it would clash on ports 9200/9300):

```bash
# in deploy/bowmore (the old ml-only compose)
docker compose down

# then start the new single node
docker compose -f deploy/bowmore-single/docker-compose.yml up -d
```

Wait for green:

```bash
curl -s '192.168.68.51:9200/_cluster/health?wait_for_status=green&timeout=60s'
```

## 4. Create the ELSER endpoint BEFORE restoring

The restored index has a `semantic_text` field that references the ELSER `inference_id`,
so the endpoint must exist for query-time inference. Use the endpoint-only script — it
does **not** touch/recreate the index (unlike `npm run setup`, which is destructive):

```bash
npm run setup:endpoint
```

Give the ELSER model a moment to deploy (it downloads/starts in the background). Confirm:

```bash
curl -s 192.168.68.51:9200/_inference | grep -o elser   # endpoint present
```

## 5. Restore `jobs` on bowmore

```bash
curl -X PUT 192.168.68.51:9200/_snapshot/migrate \
  -H 'content-type: application/json' \
  -d '{"type":"fs","settings":{"location":"/snapshots"}}'

curl -X POST '192.168.68.51:9200/_snapshot/migrate/jobs-1/_restore?wait_for_completion=true' \
  -H 'content-type: application/json' \
  -d '{"indices":"jobs","include_global_state":false}'
```

Verify the docs and that semantic search works:

```bash
curl -s '192.168.68.51:9200/jobs/_count'                 # ~2,877
curl -s '192.168.68.51:9200/jobs/_mapping' | grep -o semantic_text   # field present
```

## 6. Point the app at bowmore

Edit `.env` (default lives in `packages/shared/src/config.ts:15`):

```bash
ES_URL=http://192.168.68.51:9200      # was kilchoman's http://192.168.68.56:9200
```

Then `npm run dev` and smoke-test all three modes (`GET /api/modes` should still list
`bm25, dense, elser`). Run a couple of `elser` queries — if results come back ranked,
the migrated sparse vectors + endpoint are wired correctly.

## 7. Decommission kilchoman

Once you're happy:

```bash
# on kilchoman
docker compose down            # leave the volume if you want a rollback path
```

You can also drop the `es:up` / `es:logs` npm scripts (they ssh to kilchoman) and the
`deploy/kilchoman` compose once the single node is the source of truth.

---

### Rollback

Nothing here is destructive to kilchoman — its `mp-search-esdata` volume is untouched.
To revert: `docker compose down` the bowmore single node, bring the old
`deploy/bowmore` ml node + kilchoman back up, and set `ES_URL` back to `192.168.68.56`.

### Memory note

This single node shares bowmore's 15 GB with `qwen2.5:7b` (~5.5 GB) + `nomic-embed-text`
(~0.5 GB). The combined ES `mem_limit` is 5 GB (down from 6 GB ml + 4 GB data across two
boxes). The tight moment is a **concurrent ELSER query + chat generation** — watch
`free -h` under that load; if you hit swap, drop to a smaller/quantized chat model or
trim the ES `mem_limit`.
