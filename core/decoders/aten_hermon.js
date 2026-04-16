/*
 * noVNC: HTML5 VNC client — ATEN Hermon (0x59) decoder
 * Copyright (C) 2026 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * ATEN iKVM uses a family of proprietary pseudo-encodings in the VNC
 * framebuffer-update stream.  "Hermon" (encoding 0x59) is the oldest
 * variant and the one that X9-era Supermicro BMCs fall back to.
 *
 * See docs/aten.md for protocol notes.  This port descends from the
 * "bmc-support" branch of https://github.com/kelleyk/noVNC (commit
 * eb386b7, 2017-ish) — originally clean-room reverse-engineered by
 * Kevin Kelley against live ATEN traffic.
 */

export default class ATENHermonDecoder {
    constructor() {
        // TODO (stage 4.3): port state machine from fork's inline
        // ATEN_HERMON handler in core/rfb.js.
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        return false;
    }
}
