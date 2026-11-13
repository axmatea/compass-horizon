# COMPASS identity studies

13 November 2026. New original explorations for the account/workspace preview.
A · Fold was approved by the founder on Nov 13, 2026 and is now the public mark. These study files stay in place. Public favicon tiles use a slightly wider gap and thicker planes so the mark still reads at 16 pixels.

Review `/assets/brand-next/studies.html` in the local or staging build. It shows
three native SVG marks at 16, 24 and 32 pixels, reversed app tiles, wordmark
lockups, and the recommended direction in website, app, dock and favicon contexts.
The page has no scripts, external requests, animations or product controls.

## Directions

| Direction | Idea | Assessment |
| --- | --- | --- |
| A · Fold | Two offset geometric planes, hinting at a bearing without a literal compass dial. | Architectural and crisp. The narrow gap is less forgiving at favicon scale. |
| B · Offset | Two offset curved paths around an open center. | Recommended for the next preview: a simple one-color silhouette, generous negative space and substantial small-size strokes. Suggests a process with direction, without a map pin, arrow or AI sparkle. |
| C · Index | Squared C with a separate cursor-like bar. | Readable and compact, but the C/cursor combination is less distinctive. |

These are design judgments, not user research or trademark clearance. Validate
the recommended mark in the actual header and at browser favicon size before
replacing the existing public identity. Do not animate it as a fake AI status.

## Deliverables

All paths below are relative to `compass/public/assets/brand-next/`.

- `mark-a-fold.svg`, `mark-b-offset.svg`, `mark-c-index.svg`: original hand-authored
  vector studies; 32×32 viewBox; neutral black/currentColor; no fonts or external
  dependencies.
- `offset-app-icon.svg`: neutral dark app/social tile, 128×128 viewBox.
- `offset-dock-icon.svg`: flat white dock icon concept, 512×512 viewBox. This is an
  identity concept, not an existing native macOS application.
- `offset-favicon.svg`: stronger small-size version with a neutral dark tile.
- `studies.html`: responsive internal comparison sheet. Typography uses system
  fonts. In the application, keep its bundled Inter font and existing OFL notice;
  no new font license or dependency is introduced.
- `exploration-sheet.png`: 1774×887 original AI visual research, 1,165,728 bytes.
  Referenced only by the internal study with lazy loading, not by public headers.

The SVGs are deliberately re-authored as deterministic geometry rather than
being raster image wrappers or automatic traces. They contain no embedded image,
script, foreignObject, event handler, external URL, or copied third-party icon.
All six SVG files were XML-parsed and checked for those properties. No existing
brand assets were removed. Browser inspection of the actual placement remains
a release gate before a public replacement.

## Generation provenance

One exploratory sheet was generated using the built-in OpenAI ImageGen tool
(`image_gen.imagegen`), following the `imagegen` skill. No CLI/API-key fallback,
Artlist, Higgsfield, paid plan or additional service was used. The resulting PNG
was copied into this workspace; the original remains at
`/Users/aimediaco/.codex/generated_images/01a1d658-0e96-7062-a677-a205229e336d/exec-603e33dd-b101-4a48-916e-1d3ecbe0dbd3.png`.
The exact deployed SVG candidates are the hand-authored originals in this folder.

Prompt used:

> Use case: logo-brand. Asset type: an original exploration sheet for COMPASS, a premium AI application builder. Create a restrained editorial identity study on a pure white sheet, three generously spaced columns with one distinct original black symbol and a clean COMPASS wordmark each. Direction A: a minimal geometric open compass made of two precise interlocking planes, no literal map needle. Direction B: an abstract creative-navigation symbol, two offset continuous quarter-circle paths forming a strong open center and suggesting direction through negative space. Direction C: refined typographic identity with a distinctive compact C monogram built from a squared open curve and one short offset bar. Show each mark large, once reversed in a small near-black rounded app tile and at very small scale beneath. Black and neutral gray only, one tiny restrained blue swatch permitted. Simple intentional geometry, flat vector-friendly silhouettes, large negative space, beautiful alignment, premium software identity. Exact visible brand text only: COMPASS. No arrows, pin icons, four-point AI sparkles, literal compass dial, green, gradients, shadows, 3D chrome, illustrations or competitor marks. Do not imitate any existing logo. This is visual research, not a final exported production logo.

The raster research sheet contains additional model-generated direction labels.
The deterministic comparison page controls the final names and wording.
