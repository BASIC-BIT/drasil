# CAPTCHA image renderer evaluation

Evaluated on 2026-10-23. The adapter uses `captcha-canvas@3.4.0`, receives an explicit answer, and returns a 300 by 100 PNG of at most 256 KiB. It does not generate or verify challenge answers. No application package imports the renderer.

## Rendering configuration

| Element            | Configuration                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background         | Opaque white, constant local SVG drawn through the public image API                                                                                                                                       |
| Main text          | Liberation Sans, 48 px, `#172554`, rotation up to 10 degrees, skew enabled                                                                                                                                |
| Decoys             | 20, Liberation Sans, 18 px, `#64748b`, opacity 0.25                                                                                                                                                       |
| Trace              | 2 px, `#64748b`, opacity 0.6                                                                                                                                                                              |
| Process budget     | Two shared workers, 20 waiting jobs, typed busy rejection on saturation                                                                                                                                   |
| Execution deadline | Five seconds end to end from enqueue, including queue residence and worker startup; expire queued jobs without disturbing other workers and terminate active timed-out workers before reusing their slots |
| Worker resources   | 64 MiB V8 old-generation limit, `SKIA_CANVAS_THREADS=1`; native allocations are outside the V8 heap limit                                                                                                 |
| Output checks      | PNG signature, 300 by 100 dimensions, byte limit, chunk boundaries, image data and terminator; reject all PNG text chunks                                                                                 |

Workers require Liberation Sans before accepting work. There is no random-text fallback. The adapter accepts only six characters from the approved uppercase alphabet. Failure codes omit answers and raw dependency errors. Idle workers do not keep the process alive.

## Disposable installation and fonts

The exact candidate first installed in `/tmp/drasil-captcha-candidate`, adding ten packages. A synthetic explicit-answer probe rendered successfully on the host, Node v24.19.0, Linux x64.

The same probe ran as user 1000 in `node:24-bookworm-slim`, Node v24.22.1. The bare image reported zero font families and produced a 2,230-byte PNG. This was not accepted as usable text rendering. A fresh disposable image installed only `fonts-liberation` and installed the candidate as the unprivileged `node` user. It reported Liberation Sans and produced a 14,454-byte PNG in 34.07 ms. No compiler toolchain was installed. The Debian font version was `1:1.07.4-11`.

The first unprivileged container install could not read the default root-only CA secret mount and failed with `SELF_SIGNED_CERT_IN_CHAIN`. Retrying with a readable public CA mount succeeded. TLS verification stayed enabled. The product Dockerfile accepts an optional build-only `proxy_ca` secret for its networked npm/Prisma steps; it does not copy the CA into an image layer.

## Performance and memory

The standalone probe runs 30 serial renders, including cold startup, then 22 simultaneous submissions through the two-worker pool. Each run uses 52 synthetic cryptographically generated answers. It prints aggregate measurements only. RSS is sampled every five milliseconds and includes both workers and retained evaluation PNGs; it is an observation, not a native-memory guarantee. Latencies include queue waiting.

| Run                                                        | Samples | Largest PNG | Cold / p50 / p95 / max milliseconds | Initial / peak / final RSS bytes       |
| ---------------------------------------------------------- | ------- | ----------- | ----------------------------------- | -------------------------------------- |
| Task 1 host, Linux x64, Node v24.19.0                      | 52      | 15,107 B    | 690.16 / 9.98 / 83.64 / 690.16      | 32,899,072 / 105,111,552 / 105,111,552 |
| Task 1 runtime overlay, Linux x64, Node v24.22.1, uid 1000 | 52      | 16,545 B    | 172.63 / 10.14 / 167.04 / 181.44    | 55,074,816 / 120,315,904 / 120,315,904 |

Both Task 1 runs completed all 52 renders within the five-second enqueue deadline. The runtime probe verified Liberation Sans availability, uid 1000, and no gcc, g++, make, or rustc in their standard executable paths.

## Runtime artifact verification

The complete repository Dockerfile successfully built its runtime target, including the exact renderer dependency, the measured font package, production dependency pruning, and the application import boundary check. Its image ID was `sha256:0e1ac31f3e99b192e92f34adb589c256f8354426d6404bac97475323ddcfd432`.

A fresh full rebuild after the opaque-background fix and OCR configuration change failed because the managed daemon's vfs storage exhausted the 32 GiB disk. Removing unused task build cache recovered 13 GiB free and preserved every image, container, and volume. A controller-approved overlay copies only the final compiled renderer and final probe into the previously built runtime. This verifies the final executable artifact; it is not a successful fresh full build of the final source snapshot. A clean full branch build remained pending at that stage; the Task 8 build below completes that runtime gate.

The final overlay image is `sha256:db87bd9396204541974639a6e610ef4e49637e756ffc8493205314d86fbac2ca`. SHA-256 manifests covered 40,314 regular files and symlinks under `/app` in each artifact. Exactly two entries differed, with no additions or removals. Their final hashes match the local compiled renderer and probe:

| Runtime path                                      | Final SHA-256                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `/app/dist/src/services/captcha/imageRenderer.js` | `8923eb06f0d06ed5069aeec1e5a971b9d6e1a6420d1b46961607b5f1a44f312a` |
| `/app/scripts/probe-captcha-image.mjs`            | `aec20d7cc3cfdc150185e2a5aaf02ea04a3a25c7936b6fb6f1ff7693272c1a58` |

## Final full-source runtime build

Task 8 built the complete repository Dockerfile runtime target from the final
methods implementation plus its build-stage consolidation, rather than using an
overlay. Image ID:
`sha256:317111c3f9ddead2aaa99c1960c2975ea4c616e8ee6dd8aa08395de7eb66a5f4`.
Prisma generation, application/native compilation, production dependency pruning
and the CommonJS/ES application import check all passed. The same import
check also passed inside the final production-pruned runtime image. The consolidated build
RUN preserves that order with `&&`; it avoids retaining a full dependency snapshot
for each step on vfs builders.

The first Task 8 attempt passed those checks but exhausted the 32 GiB vfs disk
during final runtime assembly. Cleanup removed only identified superseded
CAPTCHA images and failed task build cache, preserving the disposable PostgreSQL
container/image and all volumes. The consolidated full rebuild succeeded. TLS
verification stayed enabled and the session public CA used a build-only secret
mount. No environment CA was copied into the runtime.

The fresh image's standalone probe completed all 52 renders as uid 1000 on Linux
x64/glibc, Node v24.22.1, using the same bounded worker/queue configuration:

| Samples | Largest PNG | Cold / p50 / p95 / max milliseconds | Initial / peak / final RSS bytes       |
| ------- | ----------- | ----------------------------------- | -------------------------------------- |
| 52      | 15,547 B    | 156.35 / 6.79 / 83.11 / 156.35      | 54,808,576 / 119,394,304 / 119,394,304 |

Runtime metadata confirms npm 11.19.1, `captcha-canvas@3.4.0`,
`skia-canvas@3.0.8`, and `fonts-liberation` version `1:1.07.4-11`.
Liberation Sans and renderer readiness passed. No gcc, g++, make or rustc was
present in the standard checked executable paths, the root Jest package was
absent after production pruning, and `/run/secrets/proxy_ca` was absent at runtime.

RSS remains an observation, not a native-memory cap. This run did not repeat OCR
or add human evaluation samples.

The final production web build also passed. A scan of all 34 Next.js production
dependency traces and all 26 browser JavaScript chunks found no renderer/native
asset dependency paths or browser references matching `captcha-canvas`,
`skia-canvas`, `imageRenderer`, `libskia` or `skia.node`. Web readiness uses the
server-only key decoder and does not load the renderer.

## Readability and OCR

Human readability has **zero samples and remains unverified**, including Discord desktop, mobile, and accessibility. Agent vision inspection of one initial sample found a transparent-background contrast problem; the adapter now renders an opaque white background, covered by a pixel-opacity regression test. This inspection is not a human solve-rate measurement.

Local Tesseract 5.5.0 evaluated 20 distinct images from the final host configuration. Each image used English recognition and the approved answer alphabet whitelist with page segmentation modes 7 and 8, one OpenMP thread, and a ten-second per-call deadline. It returned zero exact answers in 40 completed attempts. Earlier sandboxed child calls failed or timed out; the completed run used managed execution. No preprocessing or vision solver benchmark was performed. This small OCR observation does not establish bot resistance or security effectiveness.

## Dependency and license review

The lockfile pins the following resolved renderer graph. License identifiers come from the installed package manifests.

| Package           | Version | License    |
| ----------------- | ------- | ---------- |
| captcha-canvas    | 3.4.0   | Apache-2.0 |
| skia-canvas       | 3.0.8   | MIT        |
| detect-libc       | 2.1.2   | Apache-2.0 |
| follow-redirects  | 1.16.1  | MIT        |
| https-proxy-agent | 7.0.6   | MIT        |
| agent-base        | 7.1.4   | MIT        |
| debug             | 4.4.3   | MIT        |
| ms                | 2.1.3   | MIT        |
| parenthesis       | 3.1.8   | MIT        |
| string-split-by   | 1.0.0   | MIT        |

`skia-canvas` is the only renderer dependency with an install hook. It downloads its platform-specific native binary over HTTPS and checks a published SHA-256 digest. The evaluated npm distribution does not contain the Rust source needed for compilation fallback. Network and prebuilt-binary availability therefore matter at image build time. Rendering itself needs no network access. Only Linux x64 with glibc was evaluated.

Debian's `fonts-liberation` copyright file specifies GPL v2 with font exceptions. Preserve the distributed copyright/license files. This record identifies the licenses; it is not a legal determination.

The disposable candidate audit reported zero vulnerabilities. The repository production audit reported 32 advisories, including one critical, across its wider existing dependency graph. None named the ten renderer packages above. Task 8's final production prune reported 16 advisories, four moderate, 11 high and
one critical, for the current wider production tree. It did not perform a fresh
package-level attribution audit. The earlier audit counts above are historical.
No audit fixes or unrelated dependency updates were applied. Audit results are time-specific and do not replace future review.

## Reproduction

```sh
npm ci
npm run build
npx jest --runInBand --runTestsByPath src/__tests__/unit/captchaImageRenderer.unit.test.ts
npm test -- --runInBand
node scripts/probe-captcha-image.mjs --ocr
docker build --target runtime -t drasil-captcha-image-eval .
docker run --rm --entrypoint node drasil-captcha-image-eval scripts/probe-captcha-image.mjs
```

In the managed cloud environment, pass the provided CA through `--secret id=proxy_ca,src="$CODEX_PROXY_CERT"`, retain the configured proxy and TLS trust, and select the managed local Docker socket explicitly. OCR is optional and is not installed in the bot image. These commands do not bootstrap Discord or access a database.
