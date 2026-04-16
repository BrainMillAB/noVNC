# Guacamole on-screen keyboard (vendored)

This directory contains vendored code from **Apache Guacamole**, used
to provide an on-screen keyboard in the noVNC client.  Nothing here
is original to BrainMillAB; we are redistributing Guacamole's work
under its own Apache-2.0 licence.

## What is vendored

| File | Source in `apache/guacamole-client` |
|------|--------------------------------------|
| `OnScreenKeyboard.js` | `guacamole-common-js/src/main/webapp/modules/OnScreenKeyboard.js` |
| `osk.css` | `guacamole/src/main/frontend/src/app/osk/styles/osk.css` |
| `de-de-qwertz.json` | `guacamole/src/main/frontend/src/layouts/de-de-qwertz.json` |
| `en-us-qwerty.json` | `guacamole/src/main/frontend/src/layouts/en-us-qwerty.json` |
| `es-es-qwerty.json` | `guacamole/src/main/frontend/src/layouts/es-es-qwerty.json` |
| `fr-fr-azerty.json` | `guacamole/src/main/frontend/src/layouts/fr-fr-azerty.json` |
| `it-it-qwerty.json` | `guacamole/src/main/frontend/src/layouts/it-it-qwerty.json` |
| `nl-nl-qwerty.json` | `guacamole/src/main/frontend/src/layouts/nl-nl-qwerty.json` |
| `tr-tr-qwerty.json` | `guacamole/src/main/frontend/src/layouts/tr-tr-qwerty.json` |

Guacamole also ships a Russian (`ru-ru-qwerty`) layout; we deliberately
omit it from this vendor drop.  Users who need it can copy
`guacamole/src/main/frontend/src/layouts/ru-ru-qwerty.json` from
upstream and drop it alongside the others — the OSK loader picks it
up automatically once the filename matches the layout naming
convention.
| `LICENSE.guacamole` | `LICENSE` |
| `NOTICE.guacamole` | `NOTICE` |

Fetched from <https://github.com/apache/guacamole-client> (default
branch `main`) on **2026-04-16**.  The JSON layout files and LICENSE /
NOTICE are byte-for-byte copies.  `OnScreenKeyboard.js` differs from
the upstream only in a ~5-line change at the top (see the ES-module
conversion note inside the file) to drop the pre-ES-module
`var Guacamole = Guacamole || {}` namespacing and add
`export default Guacamole.OnScreenKeyboard` at the end.  No algorithm
or behaviour changes.

## Licence

Apache Licence, Version 2.0.  Full text in
[`LICENSE.guacamole`](./LICENSE.guacamole); the project-wide notice is
in [`NOTICE.guacamole`](./NOTICE.guacamole).  The MPL-2.0 that the
rest of this repository uses is compatible with redistributing
Apache-2.0 code alongside it (both permissive, neither imposes
copyleft on the other).  Obligations we carry:

- Preserve the Apache copyright header at the top of each vendored
  file (done — the header is intact in `OnScreenKeyboard.js` plus a
  short marker comment about the ES-module conversion).
- Preserve the `NOTICE` text and propagate it into ours
  (`NOTICE.guacamole` is a copy; see also this repository's top-level
  `ATTRIBUTION.md` for the unified credit to noVNC + Kelley + Guacamole).
- State any significant modifications.  We made one: the
  `var Guacamole = ...` → `const Guacamole = {}` + `export default`
  swap.  Documented inline in `OnScreenKeyboard.js`.

## How it is consumed

See `../../app/ui.js` for the integration site and `../../app/styles/
osk.css` for the visual styling.  The wiring is intentionally
minimal:

```js
import OnScreenKeyboard from '../vendor/guacamole-osk/OnScreenKeyboard.js';
import layout from '../vendor/guacamole-osk/en-us-qwerty.json' with { type: 'json' };

const osk = new OnScreenKeyboard(layout);
osk.onkeydown = (keysym) => rfb.sendKey(keysym, null, true);
osk.onkeyup   = (keysym) => rfb.sendKey(keysym, null, false);
container.appendChild(osk.getElement());
osk.resize(container.offsetWidth);
```

Guacamole's OSK emits raw X11 keysyms, which is exactly what noVNC's
`RFB.sendKey` expects — no translation layer required.  The ATEN
path then maps keysym → USB HID scancode via `core/input/aten_hid.js`
as usual.

## Updating to a newer Guacamole release

To refresh this vendor drop from a future Guacamole release:

1. Re-fetch the files listed above at the new tag.
2. Re-apply the ES-module conversion to `OnScreenKeyboard.js` (search
   for `var Guacamole = Guacamole || {};` — replace; add
   `export default Guacamole.OnScreenKeyboard;` at the very end).
3. Note the upstream commit SHA / release tag in the commit message.
4. Run `npm test` — the OSK integration tests in
   `tests/test.osk.js` cover the integration API surface.

Do not edit `OnScreenKeyboard.js` or the layout JSON files for local
changes.  If upstream behaviour needs altering, open a PR against
`apache/guacamole-client` first so the change flows down through the
refresh.
