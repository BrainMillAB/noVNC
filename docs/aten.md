# ATEN iKVM support in noVNC

This fork adds native support for BMCs that use ATEN-based iKVM
controllers.  In practice that means Supermicro X9/X10 (and older)
motherboards, ASRock Rack boards with ASPEED AST2100-family SoCs, and
a handful of other vendors whose BMCs speak the same wire formats.

The base noVNC protocol speaks standard [RFB].  ATEN BMCs speak a
dialect that piggybacks on standard RFB for the security-type hello but
deviates in six material places: auth handshake, server-init tail,
server→client message stream, keyboard wire format, pointer wire
format, and the video encodings themselves.

This document is a practical reference for each deviation.  All of it
is clean-room reverse-engineered — see `LICENSE.txt` and the top-of-
file headers in each ATEN source file.

[RFB]: https://github.com/rfbproto/rfbproto/blob/master/rfbproto.rst

## Detection — security type 16 with ATEN flavouring

ATEN servers advertise VNC security type 16 (Tight) and only that type.
To distinguish them from real TightVNC servers, we look at the very
first u32 the server sends after the client picks type 16:

| Field sent by server                       | Real Tight         | ATEN               |
| ------------------------------------------ | ------------------ | ------------------ |
| numTunnels                                 | 0–~few hundred     | 0, or huge (> 2^24) |
| numSubAuth (second pass, if numTunnels=0)  | 1–few              | 0, or u16 lo = 0x0100 |

Two heuristics run inside `_negotiateTightAuth()`:

- **Heuristic #0** — Server's advertised security-type list contains
  ONLY 0x10, and `numTunnels` is `<= 0` or `> 0x1000000`.  Seen on
  older Winbond / Nuvoton / Renesas BMCs.
- **Heuristic #1** — `numTunnels == 0`, and either `numSubAuth == 0`
  or `numSubAuth & 0xFFFF == 0x0100`.  Seen on newer AST2400 BMCs.

When either fires, `_rfbAtenikvm` is latched to `true` for the rest of
the connection and the code path diverts into `_negotiateATENAuth`.

The latch is checked at the top of `_negotiateTightAuth` on every
re-entry, so the credentials-required turnaround (set-creds →
setTimeout → re-enter) always resumes in the ATEN path.

## Auth — 48-byte payload, no DES

After `_negotiateATENAuth` is entered, the wire looks like:

```
server->client    16 bytes filler (meaning unknown; drain & discard)
client->server    24 bytes username, NUL-padded on the right
                  24 bytes password, NUL-padded on the right   (48 bytes total)
server->client     4 bytes SecurityResult  (0 = OK, nonzero = fail)
```

Usernames and passwords longer than 24 bytes are hard-failed client-
side.  The fork accepts a single `USER:PASSWORD` string from the
password prompt; this port uses mainline's `{username, password}`
credential object directly (same shape as ARD, so existing credential
UIs Just Work).

## ServerInit — 12-byte ATEN tail

Standard RFB ServerInit is 24 fixed bytes + 4-byte name length + name.
ATEN appends 12 bytes *after* the name:

| Offset (after name) | Bytes | Meaning                      |
| ------------------- | ----- | ---------------------------- |
| +0                  | 8     | Unknown / vendor-specific    |
| +8                  | 1     | IKVMVideoEnable flag         |
| +9                  | 1     | IKVMKMEnable flag            |
| +10                 | 1     | IKVMKickEnable flag          |
| +11                 | 1     | VUSBEnable flag              |

Currently drained and ignored.  The flags are informational; the fork
does not act on them and neither do we.

The usual TightVNC extended ServerInit block (numServerMessages,
numClientMessages, numEncodings + 16 bytes per capability) is NOT
emitted by ATEN servers, so `_rfbTightVNC` is cleared inside
`_negotiateATENAuth` to prevent that branch from firing.

## Server→client proprietary message stream

Six message types are interleaved with the standard server→client
messages (FramebufferUpdate, Bell, ServerCutText, …).  The client
drains them; none require a reply.

| Msg type | Meaning             | Payload bytes |
| -------- | ------------------- | ------------- |
| 4        | Front Ground Event  | 20            |
| 22       | Keep Alive Event    | 1             |
| 51       | Video Get Info      | 4             |
| 55       | Mouse Get Info      | 2             |
| 57       | Session Message     | 264 (4+4+256) |
| 60       | Get Viewer Lang     | 8             |

The ATEN branch lives at the top of `_normalMsg`; unhandled types
(0 / 1 / 2 / 3 / 150 / 248 / 250) fall through to the standard
dispatch.

## Keyboard — 18-byte KeyEvent with HID scancodes

Mainline noVNC sends 8-byte standard RFB KeyEvents or 12-byte QEMU
ExtendedKeyEvents.  ATEN uses an 18-byte variant of msg-type 4:

```
 0    u8   msg-type = 4
 1    u8   pad = 0
 2    u8   down (1 = press, 0 = release)
 3-4  u16  pad = 0
 5-8  u32  USB HID Usage (big-endian) — looked up via core/input/aten_hid.js
 9-17 9×u8 pad = 0
```

The XK→HID translation table (`core/input/aten_hid.js`) covers ASCII,
F-keys, common control keys, L/R-aliased modifiers, and a US-layout
hardcoded mapping of shifted punctuation to its unshifted physical key.
Unknown keysyms emit HID scancode 0 (which the BMC treats as a no-op).

## Pointer — 18-byte PointerEvent

Standard RFB PointerEvent is 6 bytes.  ATEN uses an 18-byte msg-type 5:

```
 0    u8   msg-type = 5
 1    u8   pad = 0
 2    u8   button mask (low 7 bits only — marker bit forced off)
 3-4  u16  x (big-endian)
 5-6  u16  y (big-endian)
 7-17 11×u8 pad = 0
```

ATEN does not advertise the
`pseudoEncodingExtendedMouseButtons` pseudo-encoding, so the standard-
vs-extended branch in `_sendMouse` never fires for ATEN sessions.

## Video encodings

Two relevant wire numbers (plus three nominal siblings not yet seen in
the wild):

| Number | Name           | Status        |
| ------ | -------------- | ------------- |
| 0x57   | ATEN AST2100   | Supported — `core/decoders/aten_ast2100.js` + `core/ast2100/` |
| 0x58   | ATEN ASTJPEG   | Registered; decoder not implemented (not seen in X9/X10 traffic yet) |
| 0x59   | ATEN Hermon    | Supported — `core/decoders/aten_hermon.js` |
| 0x60   | ATEN Yarkon    | Registered; decoder not implemented |
| 0x61   | ATEN Pilot3    | Registered; decoder not implemented |

### Hermon (0x59)

Simpler of the two supported encodings.  Used by X9-era BMCs and
earlier.  Wire format (per rect):

```
+--- 8-byte outer header ------------------------------+
|  u32 mysteryFlag  |  u32 payloadLen                  |
+-----------------------------------------------------+
+--- 10-byte inner header -----------------------------+
|  u8 type  |  u8 pad  |  u32 numSubrects  |  u32 len  |
+-----------------------------------------------------+
+--- payload (payloadLen - 10 bytes) ------------------+
|  type == 0: stream of 518-byte subrect records:      |
|    [u16 a][u16 b][u8 y][u8 x][16*16*2 B RGB555]      |
|  type == 1: width * height * 2 B RGB555 (raw)        |
+-----------------------------------------------------+
```

The "subrect" mode works in 16×16 tiles.  The `(y, x)` pair in each
record names the tile position (not the pixel position).  The purpose
of the `a` / `b` `u16` fields is unknown; drained.

Screen-off indicator: any rect header with `width == 64896 &&
height == 65056` signals that the remote host has blanked the display.
The decoder drains the (usually empty) payload and returns idle.

### AST2100 (0x57)

Bit-stream coded video, proprietary variant of JPEG.  Decoder lives in
`core/ast2100/`:

- `ast2100util.js` — BitStream + JpegHuffmanTable + number-format
  helpers.
- `ast2100const.js` — Huffman tables, 12 quant-table quality levels
  for luma + chroma, zigzag order, AAN IDCT scaling factors, YUV→RGB
  lookup tables.
- `ast2100idct.js` — AAN-algorithm integer IDCT (matches libjpeg's
  `jidctfst.c`).
- `ast2100.js` — top-level `Ast2100Decoder` class; parses per-frame
  quality selectors + subsampling mode, then streams MCUs through
  Huffman decode → dequant → IDCT → YCbCr→RGB → `blitCallback`.

Supports two subsampling modes the protocol labels "444" (none —
VQ-compressed blocks allowed) and "422" (actually 4:2:0 — chroma
subsampled by 2 in each direction).

Per-frame header is 4 bytes:

```
 0   u8   luma QT selector  (0x0 low quality, 0xB high)
 1   u8   chroma QT selector
 2-3 u16  subsampling mode (444 or 422)
```

The AST2100 wrapper (`core/decoders/aten_ast2100.js`) wraps an outer
8-byte ATEN header in front of the 4-byte per-frame header.  The outer
header uses the same `mysteryFlag + payloadLen` shape as Hermon.

### Pixel format

ATEN servers lie about pixel format: regardless of what the client
requests via the standard RFB `pixelFormat` message, the server ships
15-bit RGB555 packed as little-endian `u16` from the Hermon decoder;
AST2100 emits RGBX32 directly from its YCbCr→RGB conversion.

Both decoders handle their own conversion in-decoder and emit RGBX32 to
`display.blitImage`.  This avoids the "whole-pipeline pixel-format
refactor" the fork had to do on its 2017-era base.

## FramebufferUpdate dispatch quirks

Two small glue pieces live in `_handleDataRect`:

1. **Encoding 0 rewrite.**  ATEN occasionally labels a rect with
   encoding 0 (Raw) when the payload is actually Hermon (0x59).
   Gated on `_rfbAtenikvm`.

2. **Resize on dim mismatch.**  ATEN does not advertise
   `pseudoEncodingDesktopSize` / `ExtendedDesktopSize`, so the server
   cannot signal a resize via the usual pseudo-encoding path.
   Instead, it ships an FBU rect whose `(width, height)` differ from
   the current framebuffer dimensions, and the client is expected to
   pick up the size change from the rect header alone.  Screen-off
   marker (w=64896 / h=65056) is excluded.

   The check requires BOTH axes to differ, matching the fork's
   behaviour.  Preserved without judgment.

## Known issues / not-yet-ported

- **IDCT row-pass typo** (`_aan_idct_row` uses `tmp0 - tmp6` at
  position 6, where the column pass uses `tmp1 - tmp6`).  Likely
  a fork-side bug but preserved verbatim.  Fix requires an A/B visual
  comparison against real captured frames before changing.
- **AST2100 settings UI.**  The fork exposes a quality slider (0-0xB)
  and a subsampling-mode toggle.  Not ported to mainline's `app/ui.js`
  yet; decoder works without them.
- **Video encodings 0x58 ASTJPEG, 0x60 Yarkon, 0x61 Pilot3.**
  Registered in `encodings.js` but no decoders.  Add if you encounter
  them in the wild.
- **ATEN Keep-Alive reply.**  Current code drains Keep-Alive (msg 22)
  without replying.  The fork also does not reply; sessions appear to
  stay alive indefinitely without one.  If a long-running session
  ever drops, investigate here.
- **Non-US keyboard layouts.**  `core/input/aten_hid.js` hard-codes
  shifted US-ASCII punctuation.  Proper internationalisation would
  derive the physical key from DOM `code` instead.

## Reference implementation

The clean-room reverse-engineering work was done by Kevin Kelley in
2015–2017: <https://github.com/kelleyk/noVNC> branch `bmc-support`.
This fork re-ports that work onto today's ES-module noVNC mainline.

Upstream protocol pointer (used by kelleyk during RE):
`chicken-aten-ikvm` (Ruby), <https://github.com/mikesasbury/chicken-aten-ikvm>.
