# Keyboard layouts in the ATEN iKVM path

This fork's ATEN iKVM support speaks a proprietary 18-byte KeyEvent
message to the BMC carrying a **USB HID Usage Table scancode** rather
than the X keysym that standard VNC KeyEvents carry.  Translating
browser keyboard events into HID scancodes correctly requires knowing
the user's physical keyboard layout — something neither the RFB
protocol nor the browser give us a clean channel for.

This document explains what layouts are supported out of the box,
which ones cannot be supported without a layout switcher, and the
reasoning behind where we draw the line.

## How the translation works

1. The user presses a key on their physical keyboard.
2. The OS's keymap turns the scancode into an X keysym (e.g.
   `XK_aring` for `å` on a Swedish keyboard, `XK_a` for `a` on any
   Latin layout).
3. The browser delivers the keysym + DOM `code` to noVNC.
4. `core/input/aten_hid.js` (table `XK2HID`) looks up the keysym and
   returns a HID scancode corresponding to the **physical key
   position** of that letter on a matching ISO keyboard.
5. `RFB.messages.atenKeyEvent` writes the HID scancode into the
   18-byte ATEN KeyEvent and sends it to the BMC.
6. The BMC forwards the HID scancode to the guest OS's USB keyboard
   endpoint.
7. The guest OS's keymap interprets the HID scancode through **its
   own** layout setting.

**Step 7 is the crucial one.**  We do not send a character; we send a
physical-key-position notification.  The guest OS produces whatever
its layout setting says that physical position means.  This is the
same thing that happens when you plug a physical keyboard directly
into a computer — if the keyboard is labelled Swedish but the OS is
set to US, the `å` key produces `[`.

## The "safe-add" property

Many European layouts share the ANSI/ISO physical form factor but
add locale-specific letters at positions that ANSI/US leaves for
brackets and punctuation.  Because those locale-specific X keysyms
are **never emitted by a US-layout keyboard**, they can be added to
`XK2HID` alongside the US entries without risking conflict:

- Locale A user presses locale-A letter → browser emits locale-A
  keysym → we send the HID for locale-A's physical position → guest
  with locale-A layout produces the right letter.
- Locale B user presses a different locale-B letter with a different
  keysym → different lookup → different HID → works independently.
- No US-layout user ever emits the locale-A or locale-B keysyms, so
  the US base mappings are untouched.

The safe-add property requires, however, that every layout which
uses a given keysym put it at the **same physical position**.  If
layouts disagree about the HID for a keysym, we can't satisfy all
of them with a single table entry.

## Currently supported layouts

Covered by `core/input/aten_hid.js`:

| Layout family          | Locale letters covered                | Sharing             |
|------------------------|---------------------------------------|---------------------|
| US (ANSI / ISO)        | A–Z, 0–9, shifted punctuation         | base                |
| Swedish / Finnish      | å Å, ä Ä, ö Ö                         |                     |
| Danish / Norwegian     | å Å, æ Æ, ø Ø                         | å shares with SE/FI |
| German                 | ü Ü, ä Ä, ö Ö, ß                      | ä/ö share with SE/FI |
| Swiss-French / German  | è é à ä ö ü                           | entirely via DE+IT+Nordic |
| Spanish                | ñ Ñ, ¡, ¿                             |                     |
| Italian                | à, è, ì, ò, ù (+ capitals)            | à/ò share with ES/PT |
| Portuguese (EU + BR)   | ç Ç                                   | ç shares with IT    |

Guest OS must be configured for a **matching** layout for the visible
characters to match what the user typed.

## Cannot be added without a layout switcher

The following categories require a user-selectable layout because a
single keysym resolves to different HID scancodes on different
layouts — an ambiguity a global `XK2HID` cannot resolve.

### Rearranged base-letter layouts

AZERTY and Dvorak/Colemak-family layouts reassign the physical
positions of the base A–Z letters:

- **French AZERTY (`fr`)**: A↔Q, Z↔W, M relocated to the right of L.
- **French-Belgian AZERTY (`fr-BE`)**: AZERTY with further
  punctuation differences.
- **French-Canadian (`fr-CA`)**: several variants (CSA, legacy, etc.).
- **Dvorak** and **Colemak**: complete A–Z rearrangement.
- **Turkish-F**: different arrangement aimed at Turkish frequency.

When a French user types `a` the browser emits `XK_a`, but so does
a US user.  US XK_a maps to HID 0x04 (the "A" position on ANSI).
The AZERTY user's physical key for `a` is at HID 0x14 (the "Q"
position).  Different HID for the same keysym — impossible without a
way to tell the client "use the AZERTY map".

### Keysym-with-conflicting-position letters

Some letters appear at different physical positions across layouts
that each claim them:

- **`XK_eacute` (é)**: Italian puts it at HID 0x2F (shift of [).
  Swiss-French and Swiss-German put it at HID 0x33 (; pos).  French
  AZERTY puts it at HID 0x1F (2-key).  Three incompatible positions.
- **Icelandic** `XK_odiaeresis` (ö): Icelandic ISO places `ö` at
  HID 0x2D, but Nordic/German put it at HID 0x33.
- **Icelandic** `XK_eth` (ð), `XK_thorn` (þ): unique to Icelandic;
  could be added standalone, but the ö conflict means adopting
  Icelandic cleanly requires a switcher.

### Compose-heavy / dead-key / AltGr layouts

Some layouts rely on multi-keystroke input for their locale letters:

- **Polish programmer's**: `ą ć ę ł ń ó ś ź ż` via AltGr+base.  The
  browser emits the composed keysym (e.g. `XK_aogonek`) but the
  physical sequence is AltGr-down + base-letter + AltGr-up.  We'd
  need to synthesise a three-event HID sequence per composed
  keysym.
- **Czech-QWERTY**: mix of direct-key and AltGr routes; positions
  vary between Czech variants (QWERTY vs QWERTZ).
- **Hungarian**: many accented vowels on the top-number-row with
  shifted / AltGr variants.
- **Romanian**: dual-form keysyms (cedilla vs comma-below for ș/ț)
  depending on the OS's Unicode choices.

These can all be supported, but only by a layout-aware sender that
emits multiple HID scancodes per user keystroke — a feature that
does not yet exist in this codebase and is out of scope until
somebody needs it.

### Non-Latin scripts

Greek, Cyrillic (ru, bg, uk, sr, mk, …), Hebrew, Arabic, Thai,
Devanagari, CJK IMEs, etc. do not map to HID Usage Page 0x07 at
all.  HID keyboards carry only Latin-ish scancodes; the guest OS
then remaps those into the script's glyphs via its own layout.

The practical recommendation for non-Latin users is to configure
**the guest OS** with the desired script layout and type via any
Latin-producing layout on the client side — which is what physical
keyboard users do today too.

## If you want to add a new safe layout

You only need new safe-add entries if the layout introduces locale-
specific keysyms **not already covered above**, AND every layout
that uses the keysym agrees on its HID position.  Sketch:

1. Identify the layout's non-US letters.
2. For each, find the X keysym name (see `core/input/keysym.js`
   for the `KeyTable.XK_*` identifiers, or the upstream
   `keysymdef.h`).
3. Find the **physical key position** on the layout's ISO keyboard
   (Wikipedia's keyboard-layout images are a good reference).
4. Map the ANSI label of that position → HID scancode in the
   HID Usage Table (e.g. ANSI `[` = HID 0x2F, ANSI `]` = HID 0x30).
5. Check against `XK2HID` for conflicts: does any other layout
   currently map the same keysym to a different HID?  If yes, stop
   — this is a switcher-required addition.
6. If no conflicts, add the entries to `core/input/aten_hid.js` and
   a test case to `tests/test.aten_input.js`.

## If you want to add a switcher

Sketch of what a full layout switcher would look like:

1. `core/input/aten_hid.js` exports a `{ layouts: { us, fr, dvorak,
   … }, buildLayout(name) }` API instead of a single map.  Each
   layout is a keysym → HID map.
2. `RFB` takes an `atenKbdLayout` option (default `'us'`) from its
   `options` bag.
3. `app/ui.js` / `vnc.html` picks it up from a `&aten_layout=` URL
   parameter.
4. `sendKey()` consults the active layout rather than the global
   map.
5. Composed-keysym handling (Polish AltGr, dead-key sequences) is
   a follow-up behind the switcher.

Nothing conceptually blocks this; it just hasn't been done.  When a
user on a rearranged-base layout shows up and asks, it's about
150–250 LoC + per-layout tables (~70 entries per layout).  Until
then, rearranged-base users should configure the guest OS to match
their physical layout and everything else Just Works — per the
physical-keyboard analogy at the top of this document.
