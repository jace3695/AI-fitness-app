# Yeoni PHASE 4 visual-only lab

This mounts the actual `CatAnimationStage` in React StrictMode. It is not imported
by any production page. No app router, authentication, database, hosted settings,
TTS generation or API calls are included. Appearance settings are saved only at
the loopback lab origin. The HTTP server accepts only `127.0.0.1:8874` and a fixed
list of static assets. No new app dependency was added.

```sh
npm ci
npm --prefix scripts/browser-qa ci
node scripts/yeoni-poc/server.mjs
```

Open http://127.0.0.1:8874/ and enable motion. Input focus, native dialog, viewport
exit, OS reduced motion, hide, and stop should suspend the animation. The default
`reactions` appearance preference leaves this ambient-only PoC static; select
motion on in the lab to exercise it. Existing application preferences are not
rewritten by mounting the component.

Automated checks start their own server (stop any server on the same port first):

```sh
npx playwright install --with-deps chromium webkit
node scripts/yeoni-poc/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-poc/check.mjs
node scripts/yeoni-poc/export.mjs
```

If a compatible local Chromium executable is already installed, set
`YEONI_CHROMIUM` to its absolute path. This is a local test-runner override, not an
application/browser security setting. The CI workflow uses Playwright defaults.

Evidence goes to `.e2e/yeoni-poc/<browser>/`. Tests include real canvas pixel
changes and DOM state, 20 mount/unmount cycles, fallback, resizing, persistence,
and synthetic error injection. The visibility check explicitly injects a hidden
event; it does not establish real iPhone background/lock behavior or thermals.

`export.mjs` creates `docs/yeoni-phase4/Yeoni_Cat_Animation_Preview.html`, containing
the same component and images. Download and open in a normal browser. It requires
no server/account or external requests. Embedded CSP intentionally forbids
network access. This is a review artifact, not a production deployment.

## Asset provenance and quality

`public/yeoni/cat/poc-atlas-v1.png` is a transparent PNG generated with the built-in
image tool from the official `public/yeoni-cat-sprite-v1.webp`. It is a PoC asset;
the production sprite was not overwritten. Atlas output is 1254×1254. The model
did not obey an equal-cell grid, so the renderer uses measured source rectangles.
The full body includes a fixed nose/mouth/ears; independent mouth/ear/head rigs
remain future work. Do not call this a fully layered production character.

Generation prompt (identity-preserve): separate the first seated official pose
into an eyeless/tailless body, open eyes, closed eyelids and curved purple tail,
on true transparent alpha; preserve white body, purple ears/eyes/paws/collar,
mint four-point star and friendly 2.5D shading, no wings or redesign. A second
precise-object-edit pass requested removal of detached flecks/matte fringes
without changing composition or identity. At full source resolution small edge
imperfections remain. Light/dark 320–430px previews were inspected; this asset is
not approved for large final production display. Original prompt detail and the
initial/final generated images remain in the project conversation.

The user selected human concept A on 2026-09-29. No human asset was changed or
mounted in this PoC. PHASE 5 will validate Korean speech/viseme timing separately.
