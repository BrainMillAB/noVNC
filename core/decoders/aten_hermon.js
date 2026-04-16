/*
 * noVNC: HTML5 VNC client — ATEN Hermon (0x59) decoder.
 *
 * Ported from kelleyk/noVNC#bmc-support's inline ATEN_HERMON handler.
 * Hermon is the first-generation ATEN iKVM video encoding used by
 * Supermicro X9 and earlier BMCs.  The wire format:
 *
 *   +--------- 8-byte outer header (once per RFB rectangle) ---------+
 *   |  u32 mysteryFlag  |  u32 payloadLen                            |
 *   +----------------------------------------------------------------+
 *   +--------- 10-byte sub-header (once per RFB rectangle) ----------+
 *   |  u8 type  |  u8 pad  |  u32 numSubrects  |  u32 payloadLen    |
 *   +----------------------------------------------------------------+
 *   +--------- payload (payloadLen - 10 bytes) ----------------------+
 *   |  type == 0 (Subrects): stream of 518-byte subrect records:     |
 *   |     [u16 a][u16 b][u8 y][u8 x][16×16 pixels × 2B RGB555]       |
 *   |  type == 1 (RAW): width × height × 2B RGB555 pixels            |
 *   +----------------------------------------------------------------+
 *
 * The ATEN server lies about its pixel format: regardless of what the
 * client requests via the standard RFB pixelFormat message, the server
 * emits 15-bit RGB555 packed as little-endian u16.  This decoder does
 * the RGB555 → RGBX32 conversion inline and emits RGBX32 to the noVNC
 * Display.  The `depth` argument from the decodeRect contract is
 * intentionally ignored.
 *
 * Screen-off marker: the RFB rect header carries width=64896 height=
 * 65056 when the remote host has blanked the display (power-save, etc.).
 * The decoder swallows the (usually empty) payload and returns to idle.
 *
 * Resize handling is NOT done here — rfb.js does it in _handleDataRect
 * before dispatching, by observing that the rect's (width, height)
 * differs from the current framebuffer size.
 */

const SCREEN_OFF_W = 64896;
const SCREEN_OFF_H = 65056;

const SUBRECT_TYPE_SUBRECTS = 0;
const SUBRECT_TYPE_RAW      = 1;

const RGB555_BYTES_PER_PIXEL = 2;

const SUBRECT_TILE = 16;
const SUBRECT_PAYLOAD_BYTES = SUBRECT_TILE * SUBRECT_TILE * RGB555_BYTES_PER_PIXEL; // 512
const SUBRECT_HEADER_BYTES = 6;
const SUBRECT_BYTES = SUBRECT_HEADER_BYTES + SUBRECT_PAYLOAD_BYTES; // 518

export default class ATENHermonDecoder {
    constructor() {
        this._reset();
        // Scratch buffer sized for a single 16×16 RGBX32 tile.
        this._tileBuf = new Uint8Array(SUBRECT_TILE * SUBRECT_TILE * 4);
    }

    _reset() {
        this._atenLen  = -1;   // payload bytes remaining in this rectangle
        this._atenType = -1;   // subrect type (SUBRECTS or RAW); -1 = not yet read
        this._rawLines = 0;    // RAW mode: lines still to consume
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        void depth; // ATEN server always sends RGB555 regardless of depth

        // Stage 1 — outer 8-byte header.
        if (this._atenLen === -1) {
            if (sock.rQwait('ATEN_HERMON hdr', 8)) { return false; }
            sock.rQskipBytes(4); // "mysteryFlag" per kelleyk notes
            this._atenLen = sock.rQshift32();

            // Screen-off indicator.
            if (width === SCREEN_OFF_W && height === SCREEN_OFF_H) {
                if (this._atenLen !== 10 && this._atenLen !== 0) {
                    throw new Error(
                        'ATEN_HERMON: expected aten_len to be 10 or 0 when screen is off, got ' +
                        this._atenLen);
                }
                this._reset();
                return true;
            }
        }

        // Stage 2 — 10-byte inner header.
        if (this._atenType === -1) {
            if (sock.rQwait('ATEN_HERMON subhdr', 10)) { return false; }
            this._atenType = sock.rQshift8();
            sock.rQskipBytes(1);     // pad
            sock.rQskipBytes(4);     // numSubrects (unused)
            const echoed = sock.rQshift32();
            if (this._atenLen !== echoed) {
                throw new Error(
                    'ATEN_HERMON: RAW len mis-match (header=' + this._atenLen +
                    ', echo=' + echoed + ')');
            }
            this._atenLen -= 10;

            if (this._atenType !== SUBRECT_TYPE_SUBRECTS &&
                this._atenType !== SUBRECT_TYPE_RAW) {
                throw new Error('Unknown ATEN_HERMON type: ' + this._atenType);
            }
        }

        // Stage 3 — consume payload.  (type is already validated above.)
        while (this._atenLen > 0) {
            if (this._atenType === SUBRECT_TYPE_SUBRECTS) {
                if (!this._decodeSubrect(sock, display)) { return false; }
            } else {
                if (!this._decodeRaw(x, y, width, height, sock, display)) { return false; }
            }
        }

        if (this._atenLen < 0) {
            throw new Error('ATEN_HERMON: aten_len dropped below zero');
        }

        this._reset();
        return true;
    }

    _decodeSubrect(sock, display) {
        if (sock.rQwait('ATEN_HERMON subrect', SUBRECT_BYTES)) { return false; }

        sock.rQshift16(); // `a` — meaning per-subrect not documented in fork
        sock.rQshift16(); // `b`
        const ty = sock.rQshift8();
        const tx = sock.rQshift8();

        const pixels = sock.rQshiftBytes(SUBRECT_PAYLOAD_BYTES, false);
        ATENHermonDecoder._convertRgb555ToRgbx32(
            pixels, 0, this._tileBuf, 0, SUBRECT_TILE * SUBRECT_TILE);
        display.blitImage(tx * SUBRECT_TILE, ty * SUBRECT_TILE,
                          SUBRECT_TILE, SUBRECT_TILE, this._tileBuf, 0);

        this._atenLen -= SUBRECT_BYTES;
        return true;
    }

    _decodeRaw(x, y, width, height, sock, display) {
        if (this._rawLines === 0) { this._rawLines = height; }
        const bytesPerLine = width * RGB555_BYTES_PER_PIXEL;
        const rgbxLine = new Uint8Array(width * 4);

        while (this._rawLines > 0) {
            if (sock.rQwait('ATEN_HERMON RAW', bytesPerLine)) { return false; }
            const curY = y + (height - this._rawLines);
            const raw = sock.rQshiftBytes(bytesPerLine, false);
            ATENHermonDecoder._convertRgb555ToRgbx32(raw, 0, rgbxLine, 0, width);
            display.blitImage(x, curY, width, 1, rgbxLine, 0);
            this._rawLines--;
            this._atenLen -= bytesPerLine;
        }
        return true;
    }

    // ATEN packs RGB555 as little-endian u16:
    //   bits  0..4  = blue  (5 bits)
    //   bits  5..9  = green (5 bits)
    //   bits 10..14 = red   (5 bits)
    //   bit     15  = unused / ignored
    //
    // 5→8 bit upscale: (v << 3) | (v >> 2) — standard JPEG-style mapping.
    //
    // `src` / `dst` may be different typed arrays (Uint8Array here in both
    // cases); `srcOffset` is a byte offset, `dstOffset` is a byte offset,
    // `pixelCount` is how many RGB555 u16s to convert.
    //
    // Static so callers can invoke it without paying constructor cost when
    // they just need one-off conversion (e.g. tests).
    static _convertRgb555ToRgbx32(src, srcOffset, dst, dstOffset, pixelCount) {
        for (let i = 0; i < pixelCount; ++i) {
            const pixel = src[srcOffset + i * 2] |
                          (src[srcOffset + i * 2 + 1] << 8);
            const r5 = (pixel >> 10) & 0x1F;
            const g5 = (pixel >>  5) & 0x1F;
            const b5 =  pixel        & 0x1F;
            dst[dstOffset + i * 4 + 0] = (r5 << 3) | (r5 >> 2);
            dst[dstOffset + i * 4 + 1] = (g5 << 3) | (g5 >> 2);
            dst[dstOffset + i * 4 + 2] = (b5 << 3) | (b5 >> 2);
            dst[dstOffset + i * 4 + 3] = 0xFF;
        }
    }
}
