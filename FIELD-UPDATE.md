# Field update candidate

Base: e46b001, walk-test-2. Candidate: walk-test-3-candidate.
Branch: fix/inspector-identification. Runtime remains self-contained index.html.

## Implemented

Inspector selection no longer depends on list filters, recency, top-five map membership, blank-map clicks or My location. Previously selected entities cannot report another entity's inspector as their own. Close inspector dismisses explicitly; selecting another device switches it. Live text is reconciled in place, preserving expanded details and scroll.

Local service lookup adds FE0F (Signify), 180A (Device Information) and 180F (Battery). Hue advertised name plus FE0F supports a tentative lighting family; neither alone establishes it. Export adds versioned identification evidence, interpretation basis, explicit unknown model/asset, known services and a next verification step. Raw observations remain unchanged. No model, network service, GATT connection or automatic device control was added.

Sources checked 2026-11-07:
- https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Assigned_Numbers/out/en/Assigned_Numbers.pdf
- https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/DIS_v1.2/out/en/index-en.html

## Validation and delivery

Run `node tests/field-regression.cjs` and `git diff --check`.
Checks cover module syntax, corroborated and negative identification fixtures, selection ownership, stale/hidden selection, in-place updates, scroll/details preservation and explicit close. They use a DOM stub, not a real renderer or Bluetooth hardware.

Real mobile layout, touch, Bluetooth and download checks remain outstanding. Before deployment, run the existing browser smoke checks once, then on Pixel open A, select B, allow A and B to age past 30 seconds, change filters, pan/recenter, and confirm B stays open until Close inspector. Confirm live values update without losing scroll. Export and check identification alongside unchanged raw records.

GitHub push dry-run failed because no credentials exist in this workspace. Nothing deployed. Apply the accompanying commit patch in the authenticated checkout; confirm base compatibility, run checks, commit/push using the existing Pages workflow and verify live version. Preserve the existing known-good release for rollback. Do not include real captures in the public repository.

## Independent service direction (planned, not implemented)

1. Onsite: collector captures evidence; deterministic local decoders interpret it; an operator verifies a physical asset using label/photo/model and records the verification method. Keep evidence and verified labels separate.
2. Remote review first: operator exports a capture for an authorized analyst to review locally. Raw names/payloads are untrusted data, never instructions. No automatic upload.
3. Live remote operation later: a receiver must remain onsite. Use a client-approved phone or dedicated gateway and authenticated outbound transport, per-client access, explicit retention and revocation. Independent connectivity is possible if approved. A remote website alone cannot receive a distant site's Bluetooth signals. Do not expose a gateway directly to the internet.
4. Optional authorized read-only device inspection: separately scoped GATT service access may supply model/firmware. No default auto-connection, writes or control.
5. Local Gemma: optional explanation/report assistant over structured evidence and a local protocol reference collection. It must cite the observation fields behind each conclusion, preserve unknowns and never act as the source of verified identity. Choose and benchmark the actual available runtime on Pixel/laptop before integration; no assumed direct Edge Gallery/web bridge.
6. Trained classifier: collect consented, ground-truth device-family labels, verification method, device/model identifiers for evaluation grouping, decoder version and sensor conditions. Split evaluation by physical device and site/session so repeated packets do not leak into both training and test. Compare against decoder baseline; report false identifications, coverage, abstentions and latency. Start with a small classifier if it beats rules; fine-tune an LLM only if measured results justify it. Do not train on unverified heuristic labels as ground truth.

Next decision gate: five known devices, compare advertisement decoding with optional authorized reads. Measure family/model correctness and unresolved cases before expanding hardware or AI scope.
