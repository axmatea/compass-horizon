# Bounded application editing and project images

The existing account preview now edits its real application manifest and stores
owner-scoped project images. It uses the same verified database sessions, exact
origin/CSRF checks, continuity header, private request limits and preview database.
Deployment does not enable production identity or any external provider.

## Manifest and revision contract

`PUT /api/account/apps/:id/manifest` accepts exactly `{manifest,version}`.
The server validates the bounded schema, canonicalizes it, verifies the current
version and every image reference, and returns `{application,changed,files,changes}`.
An identical canonical manifest keeps its version and creates no revision.
Executable JS/TS, HTML, arbitrary URLs and unknown manifest fields are rejected.
Source other than `manifest.json` remains inspection/export only.

The optional manifest member is `assets:{logo:assetId,hero:assetId}`. Each supplied
ID must be an active image belonging to the same verified owner and application.
Empty `assets:{}` normalizes to an absent member; older manifests remain valid.
Chat/design edits preserve image selections. Business records are not replaced
by manifest changes or revision restores.

Every new revision stores SHA-256/byte receipts for actual canonical source files,
manifest/index JSON and image bytes, plus file additions/modifications/removals.
The history response includes `files`, `changes` and `receiptAvailable`. Revisions
created before this additive metadata table have `receiptAvailable:false`; their
historical source hashes are not invented. Static trusted-template code is
versioned with COMPASS; restoring a project restores its manifest/images, not an
obsolete runtime or dependency version.

## Private image API

| Method | Path | Body or result |
| --- | --- | --- |
| GET | `/api/account/apps/:id/assets` | `{assets,quota}` metadata only |
| POST | `/api/account/apps/:id/assets` | Raw PNG/JPEG; `{asset,application,changed}` |
| GET | `/api/account/apps/:id/assets/:assetId` | Verified owner's image bytes; no-store |
| DELETE | `/api/account/apps/:id/assets/:assetId` | `{ok,application,changed}` |

Upload/delete require `X-Compass-App-Version` with the expected version. Upload
uses `Content-Type:image/png` or `image/jpeg`; there is no client filename/path.
Image reads optionally reject a stale supplied version and always return the
captured `X-Compass-App-Version`. Upload/delete create real source revisions.

The server accepts at most 512 KiB per image, 8 active images per application,
4 MiB of retained image bytes per application and 16 MiB per owner. Images must
have at most 5 million pixels and 8192 pixels on either side. PNG validation
checks chunk CRC/order and bounded decompressed/filter rows, including Adam7.
JPEG validation checks bounded frame/segment/scan structure. Metadata, profiles
and comments are stripped; this can change EXIF-based orientation/color handling.
SVG, HTML, WebP, animated PNG, unsupported encoding, mismatched MIME, malformed
structure and trailing payloads are refused. Images are not arbitrary files and
never become executable source.

The SQLite row ID is server-generated. All reads/writes include owner and app.
A selected logo/hero cannot be deleted until the manifest removes its reference.
Deletion removes it from active files; immutable bytes stay available while any
of the 16 retained revision snapshots references them, so restoring history can
restore the actual image. Quotas include these retained bytes and cannot be
bypassed by deleting/reuploading. If history fills a quota the server returns a
clear quota error; it does not silently discard revision history. Once no retained
snapshot or current file uses an image, its row is pruned. The existing 64 MiB
preview database cap still applies to all data together.

## Preview and export

The opaque `allow-scripts` iframe has no same-origin permission, cookie, token,
fetch or network access. Its trusted script requests an explicitly selected
`assetId` through the bounded parent bridge. The parent checks the frame and
manifest and fetches through the owner API, returning only a PNG/JPEG data URI.
The image is rendered with DOM image elements and a data-only image CSP.

Source JSON adds `assets.json` metadata and safe `public/assets/<id>.png|jpg`
entries with `encoding:'base64'`. The ZIP writes the actual decoded image bytes,
not base64 text, and contains the complete selected-manifest runtime and active
project images. Source/preview/export headers identify the captured app version.
Source export includes application images and schema, never records, account
credentials or provider tokens. Business records use the separate private JSON
export. The standalone trusted runtime verifies packaged image hashes and serves
image data only through its authenticated API with user-continuity checks.

The existing optional external VM verifier reconstructs the no-image trusted
bundle and remains fail-closed for image bundles; no external VM was provisioned
or charged. Image bundles are tested as reviewed local trusted-template fixtures.
The legacy reviewed GitHub adapter permits text source only; complete image
portability is currently the ZIP workflow, not a claim of a live image deployment.

## Verification

Tests exercise malformed/oversized image data, image dimensions/decompression,
metadata stripping, strict schema, owner/app isolation, CSRF, optimistic versions,
no-op edits, active/retained quotas, history restore/pruning, source hashes/diffs,
actual ZIP bytes and a real exported trusted server with image session checks.
All data and accounts are disposable fixtures; no paid model/provider call is
required. Real cloud durability remains gated by the storage activation checks
and external mounted-volume/backup configuration described in AUTH_COMPLETE.md.
