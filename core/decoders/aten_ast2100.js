/*
 * noVNC: HTML5 VNC client — ATEN AST2100 (0x57) decoder entry.
 *
 * Thin wrapper that reads an ATEN AST2100 rect off the wire and feeds
 * the payload bytes to an Ast2100Decoder instance (see core/ast2100/).
 * The underlying bit-stream decoder holds state across frames (quant
 * tables, subsampling mode, VQ codebook), so exactly one Ast2100Decoder
 * instance is created per connection, lazily on the first rect.
 *
 * Wire format (same outer shape as ATEN Hermon):
 *
 *   +--- 8-byte header ---+
 *   |  u32 mysteryFlag     |  per-kelleyk: 0 in "text mode" (BIOS, no X
 *   |                      |               started), 1 when running X;
 *   |                      |               otherwise unused.
 *   |  u32 payloadLen      |  number of AST2100 bit-stream bytes that
 *   |                      |  follow.  Can be 0 (screen-off hint).
 *   +----------------------+
 *   +--- payloadLen bytes of AST2100 bit-stream ---+
 *   |  first 4 bytes: luma QT selector, chroma QT  |
 *   |  selector, u16 subsampling mode (444 or 422) |
 *   |  rest: Huffman-coded MCUs + VQ blocks        |
 *   +----------------------------------------------+
 *
 * Screen-off: rect with (w,h)=(64896, 65056) — same marker Hermon uses.
 * The payload is drained (usually empty or 10 bytes) and the decoder
 * returns idle without touching the display.
 */

import Ast2100Decoder from '../ast2100/ast2100.js';

const SCREEN_OFF_W = 64896;
const SCREEN_OFF_H = 65056;

export default class ATENAST2100Decoder {
    constructor() {
        this._atenLen = -1;
        this._decoder = null;
        this._lastWidth = 0;
        this._lastHeight = 0;
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        void depth; // AST2100 emits its own RGBX32 — pixelFormat depth ignored

        // Stage 1 — 8-byte outer header.
        if (this._atenLen === -1) {
            if (sock.rQwait('ATEN_AST2100 hdr', 8)) { return false; }
            sock.rQskipBytes(4); // mysteryFlag
            this._atenLen = sock.rQshift32();
        }

        // Screen-off indicator: drain any residual payload and return.
        if (width === SCREEN_OFF_W && height === SCREEN_OFF_H) {
            if (this._atenLen > 0) {
                if (sock.rQwait('ATEN_AST2100 screen-off drain', this._atenLen)) {
                    return false;
                }
                sock.rQskipBytes(this._atenLen);
            }
            this._atenLen = -1;
            return true;
        }

        // Zero-length payload — happens around display-off transitions.
        // Nothing to decode, nothing to blit.
        if (this._atenLen === 0) {
            this._atenLen = -1;
            return true;
        }

        // Stage 2 — pull the whole payload.  The underlying Ast2100Decoder
        // is not resumable on partial input, so we wait for everything.
        if (sock.rQwait('ATEN_AST2100 payload', this._atenLen)) {
            return false;
        }
        const data = sock.rQshiftBytes(this._atenLen, false);
        this._atenLen = -1;

        // Lazy-create the long-lived inner decoder on first use.  Later
        // frames reuse the same instance — it retains learned quant
        // tables, subsampling mode, and VQ codebook between frames.
        if (!this._decoder) {
            this._decoder = new Ast2100Decoder({
                width: width,
                height: height,
                blitCallback: (bx, by, bw, bh, buf) => {
                    display.blitImage(bx, by, bw, bh, buf, 0);
                },
                videoSettingsChangedCallback: (_settings) => {
                    // TODO (bucket G / post-Stage 5): forward quality /
                    // subsampling-mode changes to a UI callback so the
                    // settings panel can reflect what the server is
                    // actually sending.  No-op for now — the decoder is
                    // fully functional without the UI hook.
                },
            });
            this._lastWidth = width;
            this._lastHeight = height;
        } else if (this._lastWidth !== width || this._lastHeight !== height) {
            this._decoder.setSize(width, height);
            this._lastWidth = width;
            this._lastHeight = height;
        }

        this._decoder.decode(data);
        return true;
    }
}
