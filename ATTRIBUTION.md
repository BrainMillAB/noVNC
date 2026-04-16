# Attribution

This repository is a fork of [**noVNC**](https://github.com/novnc/noVNC)
with additional support for BMCs that use ATEN-based iKVM controllers
(Supermicro X9/X10 and other AST2100/AST2400-based boards).

Almost none of the code here is original to BrainMillAB.  What we have
done is adapt two bodies of upstream work and stitch them together on
modern noVNC mainline.

## Primary upstream — noVNC

Everything outside of the ATEN-specific files (RFB protocol handling,
standard VNC encodings and decoders, the Display canvas pipeline, the
input stack, the UI, the test harness, the entire client as you see
it) is **noVNC**, authored and maintained by the noVNC team:

- Joel Martin <github@martintribe.org>
- Samuel Mannehed <samuel@cendio.se>
- Pierre Ossman <ossman@cendio.se>
- and the many other contributors credited in `AUTHORS`.

noVNC project: <https://github.com/novnc/noVNC>
Licensed under the Mozilla Public License 2.0 (see `LICENSE.txt`).

When upgrading this fork, rebase onto `novnc/noVNC:master` rather
than diverging.  The ATEN additions are deliberately small, localised
per file, and designed to slot into upstream's architecture (decoder
registry, `_negotiateAuthentication` switch, `sendKey` branch point,
etc.) so that cost-of-rebase stays low.

## ATEN support — Kevin Kelley's clean-room reverse engineering

**Every piece of ATEN-specific code in this repository derives from
clean-room reverse-engineering work by Kevin Kelley between 2015 and
2017**, originally published in:

<https://github.com/kelleyk/noVNC> (branch `bmc-support`)

Kelley's work is the **complete basis** for ATEN support here.  The
hard, original parts — all done by him:

- Identifying the ATEN-iKVM-inside-Tight-security-type-16 detection
  heuristics.
- The ATEN auth-handshake wire format (padding layout, 24-byte
  null-terminated username/password fields, 48-byte payload).
- The ATEN proprietary server→client message types (4, 22, 51, 55,
  57, 60) and their payload sizes.
- The ATEN keyboard wire format (18-byte KeyEvent carrying USB HID
  scancodes rather than keysyms).
- The ATEN pointer wire format (18-byte PointerEvent).
- Identifying the XK→USB-HID translation table for common keys.
- The ATEN Hermon (0x59) framebuffer-update stream structure
  (8-byte header, 10-byte sub-header, 16×16 subrect layout, RAW sub-
  mode, screen-off marker).
- **The entire AST2100 (0x57) bit-stream decoder — a clean-room
  reimplementation of ATEN's proprietary JPEG variant including the
  custom Huffman tables, 12 quantization-table quality levels, zigzag
  order, AAN-algorithm integer IDCT, YCbCr→RGB integer lookup
  tables, MCU framing, and the VQ-block variant.**

The AST2100 decoder — `core/ast2100/*.js` — is a straight ES-module
port of Kelley's original `core/ast2100/*.js` files, algorithm
byte-for-byte equivalent.  Each ported file carries his copyright
header:

```
(c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>
```

We preserve that header and it should not be removed.

## What BrainMillAB did — the 2026 re-port

The work that is original to this repository is:

1. **Re-porting** Kelley's 2017-era fork forward across ~9 years of
   upstream noVNC drift (pre-ES-modules → ES modules, Karma+mocha
   test-harness differences, `/*global*/` JSHint pragmas →
   `import`/`export`, `var`→`let`/`const`, IIFE-scoped classes → ES6
   classes).  The algorithm itself is not changed.
2. **Adapting** the ATEN protocol touchpoints to mainline's cleaner
   architecture: decoder registry (rather than a giant switch in
   `rfb.js`), the ARD-style `credentialsrequired` CustomEvent for the
   auth prompt (rather than the fork's callback), `_handleDataRect`
   pre-dispatch glue for ATEN's resize-via-rect-dimension behaviour.
3. **Tests** (~67 new `it()` blocks) covering every ported wire
   format, plus carrying Kelley's test fixtures (the 72 KB
   `frame4.hex` captured AST2100 frame and the IDCT vector cases)
   forward to mocha + chai.
4. **One empirical protocol fix** where Kelley's fork read 16 bytes
   of ATEN pre-auth filler but real Supermicro X9 firmware sends 20
   — documented in `_negotiateATENAuth` and the corresponding commit.
5. **Documentation** (`docs/aten.md`) as a practical reference for
   every ATEN deviation from standard RFB.

## On-screen keyboard — Apache Guacamole

The on-screen keyboard feature in `app/ui.js` is built on vendored
code from [**Apache Guacamole**](https://guacamole.apache.org/) —
`OnScreenKeyboard.js` plus eight keyboard-layout JSON files.  See
`vendor/guacamole-osk/` for the full list, the ES-module conversion
note, and the required NOTICE / LICENSE files carried forward.  The
vendored code is Apache-2.0; this repository is MPL-2.0.  The two
licences are compatible for redistribution.

What is original to us in this area:

- The ~200-line integration glue in `app/ui.js` wiring the OSK into
  noVNC's `RFB.sendKey`, the toggle button, layout selection via URL
  param, and lazy instantiation.
- `app/styles/osk.css` — visual styling for the overlay (Guacamole
  ships no CSS; each consumer skins it locally).
- ATEN-specific behaviour: the keysyms emitted by Guacamole OSK flow
  through `core/input/aten_hid.js` for USB HID translation, same as
  physical-keyboard keystrokes.

## License

- noVNC: **MPL-2.0** (`LICENSE.txt`).
- Kelley's fork: **MPL-2.0** (preserved via the standard noVNC file
  headers).
- Apache Guacamole vendor drop: **Apache-2.0**
  (`vendor/guacamole-osk/LICENSE.guacamole`).
- This fork: **MPL-2.0** — no license change.  All original Kelley,
  noVNC, and Apache Guacamole copyright notices are retained in
  their respective source files and NOTICE files.

No part of this repository is closed-source or licence-incompatible
with either upstream.

## Practical advice if you are building on this

- For modifications to the **RFB core, decoders other than ATEN, UI,
  or input stack**: these are noVNC territory.  Consider whether your
  change belongs upstream (`novnc/noVNC`) rather than here.
- For modifications to the **ATEN protocol layer** (anything under
  `core/ast2100/`, `core/decoders/aten_*`, `core/input/aten_hid.js`,
  or the ATEN branches inside `core/rfb.js`): these are the re-ported
  Kelley work.  Check his original `bmc-support` branch for the
  earlier version of the same code — it is often the better mental
  model for algorithmic decisions (the ES-module shape can obscure
  the original structure).
- **Do not silently drop the Kelley copyright headers** during
  modernisation.  They belong there.

## Contact

- noVNC issues / changes destined for upstream: file against
  <https://github.com/novnc/noVNC>.
- ATEN-specific bugs / changes in this fork: file against the
  BrainMillAB fork.
- Kevin Kelley's original `bmc-support` tree is effectively unmaintained
  since 2017 — do not file new issues there.
