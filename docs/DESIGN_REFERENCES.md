# COMPASS white instrument: design references

Reviewed 12 November 2026. These are principles and implementation decisions, not copied layouts or assets.

## Direction

- [Apple: motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) — transitions should explain a state change and respect reduced motion. COMPASS uses short opacity/position transitions, visible recording state, and native video controls; no scroll-jacking or autoplay audio.
- [Linear: a calmer interface](https://linear.app/now/behind-the-latest-design-refresh) — make primary work prominent and let navigation recede. The preview owns the space; brief and build activity are progressively disclosed. Controls keep consistent positions.
- [Framer: product presentation](https://www.framer.com/) — show the output and the canvas early. The homepage puts an actual builder beside its labelled starting layout, then uses three clearly illustrative website starters and a recorded product film. No Framer layout, image, video, logo or code is reused.

White/off-white surfaces, near-black type, neutral rules and a restrained #3455e8 interaction accent form the shared system in `compass/src/site/tokens.css`. Green is not a brand color. Example-page status colors remain semantic rather than product branding.

## Library and licence evaluation

| Option | Primary source | Decision for this release |
| --- | --- | --- |
| shadcn/ui | [MIT licence](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md) | Useful React component patterns; introducing its React/Tailwind foundation would replace a working plain-JavaScript product. No code imported. |
| Radix Primitives | [Accessibility approach](https://www.radix-ui.com/primitives/docs/overview/introduction), [MIT licence](https://github.com/radix-ui/primitives/blob/main/LICENSE) | Appropriate for complex React widgets. Native buttons, forms and details/summary cover this interface without a new framework. |
| Motion | [MIT licence](https://github.com/motiondivision/motion/blob/main/LICENSE.md) | Supports richer animation, but the required feedback and reveals are achievable with native CSS. No runtime added. |
| GSAP | [Standard No Charge licence](https://gsap.com/community/standard-license/) | Its own licence rather than an assumed MIT grant. A timeline engine is unnecessary for a calm editor; not installed. |
| React Three Fiber | [Repository licence](https://github.com/pmndrs/react-three-fiber/blob/master/LICENSE) | A React/Three.js renderer adds no value to a two-dimensional page builder. No 3D scene or dependency added. |
| Tailwind CSS | [MIT licence](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE) | A viable utility system, but shared CSS tokens provide consistency without changing the existing CSS build architecture. |

The retained Inter subset is licensed under SIL OFL 1.1; the existing attribution remains in `compass/public/licenses/inter-OFL.txt`. This release adds no third-party image, video, font or component licence. Existing film provenance is recorded separately; the homepage labels the bundled earlier prepared-example recording rather than presenting it as proof of the current live model.

## Honest product boundary

The current runtime creates and revises a single HTML website preview. It does not establish a production application, customer authentication, a database, billing, or external publishing. The homepage describes first pages, desktop/phone previews and HTML downloads. Illustrative website starters open editable prompts; they are not represented as customer products. Local project continuity belongs to the full builder.
