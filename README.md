# Image Processing Project

Upload photos and have each one validated asynchronously. Every photo ends up in
**Accepted** or **Rejected**, and each rejection says why.

- **Frontend**: React 19, TypeScript and Vite. Validates files before upload,
  shows per-file progress and live status over Server-Sent Events, and renders previews.
- **API**: Node.js, Express 5, TypeScript and Knex on PostgreSQL. Stores originals in S3.
- **Worker**: a separate process that pulls jobs from a Postgres-backed queue. It
  decodes images (including HEIC), converts them to JPEG and applies the
  validation rules with `sharp` and a face detector.

![Rejected images show the reason](docs/screenshot.png)

## Quick start

### Everything in Docker

```bash
docker compose up --build
# open http://localhost:8080
```

This starts PostgreSQL, LocalStack (S3), the API, two worker replicas and the
nginx-served UI. No cloud account is needed.

### Local development

You need Node 22+, PostgreSQL 14+ and an S3 endpoint. LocalStack works:
`docker run -p 4566:4566 localstack/localstack:4.14.0`. Alternatively, set
`STORAGE_DRIVER=local` to keep files on disk.

```bash
cd backend
cp .env.example .env            # edit DATABASE_URL / S3 settings
npm install
npm run migrate
npm run dev:api                 # http://localhost:4000
npm run dev:worker              # in a second terminal

cd ../frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api to :4000)
```

To use real AWS S3, remove `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` and
`S3_FORCE_PATH_STYLE`, set `S3_BUCKET` and `S3_REGION`, and provide credentials
through the standard AWS environment variables or an instance role.

### Tests

```bash
cd backend && TEST_DATABASE_URL=postgres://user:pass@localhost:5432/images_test npm test
cd frontend && npm test
```

The backend integration suites (API, queue and the full processing pipeline) need
`TEST_DATABASE_URL` and are skipped without it. The pipeline suite runs the real
face detector and HEIC decoder over the fixtures in `backend/test/fixtures`. CI
(`.github/workflows/ci.yml`) runs both packages against a Postgres service container.

## Architecture

```
 Browser ──POST /api/images (multipart)──▶ API ──put original──▶ S3
    ▲                                       │
    │                                       └─ INSERT images (status=pending) + NOTIFY image_jobs
    │                                                           │
    │                                  Worker(s) ◀── LISTEN ────┘
    │                                   │ claim: UPDATE … FOR UPDATE SKIP LOCKED
    │                                   │ get original from S3 → decode/convert → analyse
    │                                   │ put processed JPEG + WebP thumbnail to S3
    │                                   └─ UPDATE status + NOTIFY image_events
    │                                                           │
    └──── SSE /api/images/events ◀── API ◀── LISTEN ────────────┘
```

**Upload is synchronous; validation is not.** The API checks only what the bytes
alone can decide: the format from magic bytes, and the file size. It stores the
original and returns `202 Accepted` right away. Decoding, face detection and
hashing are CPU-heavy, so they run in the worker. Workers scale horizontally
without affecting API latency.

**Postgres is the queue.** The `images` table doubles as the job queue, so there
is no Redis or SQS to operate. Workers claim jobs with
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, which lets any number
of workers poll without ever getting the same image twice. Other properties:

- `LISTEN/NOTIFY` wakes idle workers instantly. Polling every 5 s remains as a
  fallback.
- Failed jobs retry with exponential backoff (`run_after`). After
  `WORKER_MAX_ATTEMPTS` attempts, the image is marked `failed`.
- Jobs locked by a crashed worker are requeued once `locked_at` is stale.
- `NOTIFY` is sent inside the transaction, so it is delivered only on commit.
  Listeners never see an event for a change that was rolled back.

Moving to SQS or BullMQ would change only `claimJobs`, `complete` and `fail` in
`imageRepository.ts`, plus `JobRunner`.

**Live status.** The API holds a single `LISTEN image_events` connection and fans
events out to browsers over SSE. After a reconnect, the client refetches its
lists, because events sent while it was disconnected are lost.

## Validation rules

| Rule | Where | How |
|---|---|---|
| Format must be JPEG, PNG or HEIC | Browser and API | Browser: extension, MIME type and magic bytes. API: magic bytes only; client claims are ignored. HEIC means an ISO-BMFF `ftyp` box with an HEVC brand. AVIF shares the container and is rejected. |
| File too small | API, at upload | `size < MIN_FILE_BYTES` (10 KB). The file is rejected without being stored. |
| Resolution too low | Worker | Width or height, after EXIF rotation, below `MIN_WIDTH`×`MIN_HEIGHT` (400×400). |
| Blurry | Worker | Variance of the Laplacian per tile of a 4×4 grid on a 512 px grayscale copy. The **sharpest** tile must reach `BLUR_THRESHOLD` (50). Scoring the whole frame would reject sharp portraits with a soft background (bokeh). In calibration, a sharp portrait scored 131, its σ=2 blur 15 and σ=4 blur 5. |
| Too similar to an existing image | Worker | 64-bit difference hash (dHash), compared by Hamming distance against **accepted** images. `≤ SIMILARITY_MAX_DISTANCE` (8) is a duplicate. Re-encoded or resized copies measured 0–2; unrelated photos 24–35. |
| Multiple faces | Worker | SSD-MobileNetV1 face detector (face-api.js on the TensorFlow.js WebAssembly backend), confidence ≥ 0.6. |
| Face too small | Worker | The largest face's box height divided by the image height must be at least `FACE_MIN_HEIGHT_RATIO` (0.15). |

Additional behaviour:

- All failing rules are reported, not just the first, so a user can fix
  everything in one go.
- Files that claim a supported format but can't be decoded are rejected as
  `CORRUPT_IMAGE`.
- Images above `MAX_INPUT_PIXELS` are rejected as `IMAGE_TOO_LARGE`, based on
  the header, before anything is decoded.
- Every threshold is an environment variable.
- The raw metrics (`blur_score`, `face_count`, `face_height_ratio`, `phash`) are
  stored, so thresholds can be audited and re-tuned against real data.
- An image with **no** detected face is accepted, because the requirements only
  cover faces that are too small or too many. Making a face mandatory is a
  one-line rule in `rules.ts`.

**HEIC conversion.** The prebuilt `sharp`/libvips binaries ship without an HEVC
decoder, for patent-licensing reasons. HEIC is therefore decoded with libheif
compiled to WebAssembly (`heic-decode`) and handed to sharp as raw pixels. Every
decodable upload gets two derivatives, both re-encoded from pixels, which also
strips EXIF data such as GPS location:

- a normalised JPEG, where the HEIC→JPEG conversion happens
- a 480 px WebP thumbnail for the UI

**Race-free duplicate detection.** Two near-identical photos processed at the
same moment by different workers could both pass a naive check. The final
decision (similarity lookup plus status update) runs in a transaction behind a
transaction-scoped advisory lock, so only one of them is accepted. A test covers
this case.

## REST API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/images` | Multipart upload, field `images` (up to 10 files). Returns `202` with one record per file, each `pending` or already `rejected`. |
| `GET` | `/api/images?status=accepted,rejected&limit=30&cursor=…` | Lists images newest-first with keyset pagination. Returns `{ data, nextCursor }`. |
| `GET` | `/api/images/stats` | Counts per status. |
| `GET` | `/api/images/:id` | Returns one image. |
| `GET` | `/api/images/:id/{thumbnail,processed,original}` | `302` redirect to a short-lived presigned S3 URL. |
| `DELETE` | `/api/images/:id` | Deletes the record and its S3 objects. Returns `204`. |
| `GET` | `/api/images/events` | Server-Sent Events: `image.updated`, `image.deleted`, `resync`. |
| `GET` | `/api/health` | Liveness check, including the database. |

Errors are always shaped as `{ "error": { "code": "…", "message": "…" } }`,
for example `LIMIT_FILE_SIZE` (413), `VALIDATION_ERROR` (400) or `NOT_FOUND` (404).

There is intentionally no `PUT`/`PATCH`. An image's content and verdict are
derived by the server, so the client-writable operations are create and delete.

## Data model

A single `images` table (`backend/src/db/migrations`) holds:

- **identity:** UUID `id`
- **input:** display filename, detected `format`/`mime_type`, `size_bytes`
- **outcome:** `status` (Postgres enum: `pending → processing → accepted | rejected | failed`)
  and `rejection_reasons` (JSONB array of `{code, message}`)
- **metrics:** `width`, `height`, `blur_score`, `face_count`, `face_height_ratio`,
  `phash` (BIGINT), `similar_to_id` (self-FK, `ON DELETE SET NULL`)
- **storage:** `original_key`, `processed_key`, `thumbnail_key`
- **queue:** `attempts`, `run_after`, `locked_at`, `last_error`
- **timestamps:** `created_at` (ms precision, so keyset cursors round-trip exactly
  through a JS `Date`), `updated_at`, `processed_at`

Every hot query has an index built for it:

| Query | Index |
|---|---|
| List all, newest first | `(created_at DESC, id DESC)` |
| List by status | `(status, created_at DESC, id DESC)` |
| Claim due jobs | partial `(run_after, created_at) WHERE status='pending'` |
| Requeue stale jobs | partial `(locked_at) WHERE status='processing'` |
| Similarity scan | partial covering `(phash) INCLUDE (id) WHERE status='accepted'` |

Pagination is keyset-based (`(created_at, id) < cursor`) rather than `OFFSET`, so
page 1,000 costs the same as page 1.

## Security

- **Content, not claims.** The format is decided from magic bytes on the server.
  Filenames are display-only and sanitised. Storage keys are server-generated
  UUIDs, so a filename can never influence a path.
- **Bounded input.**
  - Per-file size, file-count and part-count limits in multer.
  - A pixel-count limit checked from the header before decoding (decompression
    bombs).
  - A rate limit on uploads.
  - A 10 KB JSON body limit.
  - Malformed multipart bodies get a `400` response, not a `500`.
- **Re-encoding.** Everything served back is re-encoded from decoded pixels, so
  embedded payloads and EXIF/GPS metadata are dropped. Originals are served only
  through presigned URLs.
- **Private bucket.** Objects are never public. The API redirects to presigned
  GET URLs valid for 5 minutes, so `<img src>` URLs stay stable while access
  stays short-lived. AWS uploads use SSE-S3.
- **Headers.** Helmet, a CORS allowlist, no `x-powered-by`, and internal error
  text never sent to clients.
- **Least privilege.** Containers run as the non-root `node` user.

## Scaling notes and trade-offs

- **Throughput.** The worker is the bottleneck: about 0.5–2 s per image on one
  core. It scales out by adding replicas (`deploy.replicas`) or raising
  `WORKER_CONCURRENCY`. The API does little work per request.
- **Memory.** Uploads are buffered in memory (default max 20 MB × 10 files per
  request). The UI sends one file per request with 3 in parallel. At higher
  volume, clients should upload straight to S3 with presigned POSTs, and the API
  would only record the key.
- **Similarity search.** It is a linear, index-only scan over accepted hashes:
  8-byte keys and a `bit_count` per row, fast into the low millions. Beyond
  that, the next step is multi-index hashing: split the 64-bit hash into
  `d + 1` bands stored in an indexed side table. By the pigeonhole principle, any
  hash within distance `d` matches at least one band exactly, so only those
  candidates need a distance check. pgvector with binary vectors is another option.
- **Decision lock.** The advisory lock serialises only the few-millisecond
  decision step, not processing. At very high volume, the lock could be sharded
  by a hash band.
- **Face detection limits.** The detector runs at 640 px, so a full-frame pass
  starts missing faces entirely once they're under roughly 10% of the image
  height — the whole image is downscaled to fit the detector's input, and the
  face shrinks along with it. When the full frame comes back empty, a second
  pass crops four overlapping 60%×60% quadrants (anchored to each corner, so
  adjacent quadrants share a 20% margin) and re-runs detection on each; a
  smaller crop downscales less on the way to the same 640 px input, so a small
  face effectively appears larger. That recovers faces down to about 6% of the
  frame height. Detections from overlapping quadrants are merged back into
  image coordinates with greedy non-max suppression (IoU > 0.3), so a face
  picked up by two adjacent quadrants is reported once. Below ~6% the image is
  still treated as having no face rather than a too-small one.
- **Cleanup.** If deleting S3 objects fails after the row is gone, the objects
  are orphaned but unreferenced. A bucket lifecycle rule or a periodic sweep
  handles that.

## Project layout

```
backend/
  src/
    config.ts               env parsing and validation (zod)
    server.ts / worker.ts   process entry points
    db/                     knex, migrations, LISTEN client
    http/                   express app, error mapping
    images/                 routes, service, repository (SQL + queue), DTOs, SSE hub
    processing/             format sniffing, decode/HEIC, blur, dHash, faces, rules
    queue/jobRunner.ts      worker loop: claim → process → complete/fail
    storage/                S3 and local-disk implementations
  test/                     unit + integration tests, fixtures
frontend/
  src/
    api/                    typed client (XHR for upload progress), DTO types
    lib/validateFile.ts     pre-upload checks
    state/uploadsReducer.ts reducer + selectors (pure, unit-tested)
    hooks/                  useImageUploads (queue, loading, actions), useImageEvents (SSE)
    components/             DropZone, ImageSection, ImageCard, Preview, StatusBadge
```

Test fixtures come from the MIT-licensed
[face-api demo images](https://github.com/vladmandic/face-api/tree/master/demo)
and the [libheif example HEIC](https://github.com/strukturag/libheif/tree/master/examples).
