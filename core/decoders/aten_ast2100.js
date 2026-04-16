/*
 * noVNC: HTML5 VNC client — ATEN AST2100 (0x57) decoder
 * Copyright (C) 2026 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Entry point for the ATEN AST2100 pseudo-encoding (0x57).  The actual
 * bit-stream decoder (Huffman + zigzag + dequant + IDCT + VQ blocks)
 * lives under core/ast2100/.  This module implements the noVNC decoder
 * interface (decodeRect) and feeds raw payload bytes into an
 * Ast2100Decoder instance whose blitCallback writes RGBX32 to the
 * Display.
 *
 * See docs/aten.md for protocol notes.  Descends from kelleyk's
 * bmc-support fork (core/ast2100/*, plus the fork's inline AST2100
 * framing in core/rfb.js).  AST2100 decoder code is clean-room
 * reverse-engineered by Kevin Kelley, 2015-2017.
 */

export default class ATENAST2100Decoder {
    constructor() {
        // TODO (stage 4.4): wire Ast2100Decoder from core/ast2100/ in
        // once that package has been ported.  Until then this is a
        // registered-but-inert decoder so the registry shape is stable.
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        return false;
    }
}
