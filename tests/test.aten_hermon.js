/*
 * Unit tests for the ATEN Hermon (0x59) decoder.
 *
 * Hermon data is clean-room reverse-engineered from ATEN BMC traffic
 * (kelleyk/noVNC#bmc-support).  These tests exercise the four wire-
 * format paths: the screen-off marker, the "raw RGB555" sub-mode, the
 * "16×16 subrect" sub-mode, and the standalone RGB555 → RGBX32
 * conversion helper.
 */

import Websock from '../core/websock.js';
import Display from '../core/display.js';
import ATENHermonDecoder from '../core/decoders/aten_hermon.js';
import FakeWebSocket from './fake.websocket.js';

const SCREEN_OFF_W = 64896;
const SCREEN_OFF_H = 65056;

//
// Helpers
//

function testDecodeRect(decoder, x, y, width, height, data, display, depth) {
    const sock = new Websock();
    sock.open('ws://example.com');

    let done = false;
    sock.on('message', () => {
        done = decoder.decodeRect(x, y, width, height, sock, display, depth);
    });

    if (data.length === 0) {
        done = decoder.decodeRect(x, y, width, height, sock, display, depth);
    } else {
        sock._websocket._receiveData(new Uint8Array(data));
    }

    display.flip();
    return done;
}

// Build an 8-byte outer header: [u32 mysteryFlag=0][u32 payloadLen].
function outerHeader(payloadLen) {
    return [
        0, 0, 0, 0,
        (payloadLen >>> 24) & 0xff,
        (payloadLen >>> 16) & 0xff,
        (payloadLen >>>  8) & 0xff,
         payloadLen         & 0xff,
    ];
}

// Build a 10-byte inner sub-header: [u8 type][u8 pad][u32 numSubrects][u32 echoed payloadLen].
function subHeader(type, payloadLen, numSubrects = 0) {
    return [
        type, 0,
        (numSubrects >>> 24) & 0xff,
        (numSubrects >>> 16) & 0xff,
        (numSubrects >>>  8) & 0xff,
         numSubrects         & 0xff,
        (payloadLen >>> 24) & 0xff,
        (payloadLen >>> 16) & 0xff,
        (payloadLen >>>  8) & 0xff,
         payloadLen         & 0xff,
    ];
}

// Encode a single pixel in ATEN's RGB555 little-endian u16 layout.
//  bits 0..4   = blue,  5..9 = green,  10..14 = red
function rgb555(r5, g5, b5) {
    const v = ((r5 & 0x1F) << 10) | ((g5 & 0x1F) << 5) | (b5 & 0x1F);
    return [v & 0xff, (v >>> 8) & 0xff];
}

//
// Tests
//

describe('ATEN Hermon decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new ATENHermonDecoder();
        display = new Display(document.createElement('canvas'));
        display.resize(32, 32);
    });

    describe('RGB555 → RGBX32 conversion', function () {
        it('maps all-bits-set to saturated white', function () {
            const src = new Uint8Array([0xFF, 0x7F]); // R5=31 G5=31 B5=31, bit 15 ignored
            const dst = new Uint8Array(4);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 1);
            expect([...dst]).to.deep.equal([0xFF, 0xFF, 0xFF, 0xFF]);
        });

        it('maps all-zero to opaque black', function () {
            const src = new Uint8Array([0x00, 0x00]);
            const dst = new Uint8Array(4);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 1);
            expect([...dst]).to.deep.equal([0x00, 0x00, 0x00, 0xFF]);
        });

        it('maps pure R5=31 to saturated red', function () {
            const src = new Uint8Array(rgb555(31, 0, 0));
            const dst = new Uint8Array(4);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 1);
            expect([...dst]).to.deep.equal([0xFF, 0x00, 0x00, 0xFF]);
        });

        it('maps pure G5=31 to saturated green', function () {
            const src = new Uint8Array(rgb555(0, 31, 0));
            const dst = new Uint8Array(4);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 1);
            expect([...dst]).to.deep.equal([0x00, 0xFF, 0x00, 0xFF]);
        });

        it('maps pure B5=31 to saturated blue', function () {
            const src = new Uint8Array(rgb555(0, 0, 31));
            const dst = new Uint8Array(4);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 1);
            expect([...dst]).to.deep.equal([0x00, 0x00, 0xFF, 0xFF]);
        });

        it('uses the 5→8 bit expansion (v<<3)|(v>>2)', function () {
            // Mid-grey R5=G5=B5=16 → 8-bit = (16<<3)|(16>>2) = 128|4 = 132
            const src = new Uint8Array(rgb555(16, 16, 16));
            const dst = new Uint8Array(4);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 1);
            expect([...dst]).to.deep.equal([132, 132, 132, 0xFF]);
        });

        it('converts a batch correctly', function () {
            // Three pixels: white, red, black.
            const src = new Uint8Array([
                ...rgb555(31, 31, 31),
                ...rgb555(31, 0, 0),
                ...rgb555(0, 0, 0),
            ]);
            const dst = new Uint8Array(12);
            ATENHermonDecoder._convertRgb555ToRgbx32(src, 0, dst, 0, 3);
            expect([...dst]).to.deep.equal([
                0xFF, 0xFF, 0xFF, 0xFF,
                0xFF, 0x00, 0x00, 0xFF,
                0x00, 0x00, 0x00, 0xFF,
            ]);
        });
    });

    describe('wire-format decode', function () {
        it('handles the screen-off marker (aten_len=10)', function () {
            // Outer header only, width/height indicate screen-off.
            const data = outerHeader(10);
            const done = testDecodeRect(decoder, 0, 0,
                SCREEN_OFF_W, SCREEN_OFF_H, data, display, 24);
            expect(done).to.be.true;
        });

        it('handles the screen-off marker (aten_len=0)', function () {
            const data = outerHeader(0);
            const done = testDecodeRect(decoder, 0, 0,
                SCREEN_OFF_W, SCREEN_OFF_H, data, display, 24);
            expect(done).to.be.true;
        });

        it('rejects unknown aten_type', function () {
            // outer: payloadLen 10 (just the sub-header, no payload)
            // sub: type=99 (invalid)
            const data = [...outerHeader(10), ...subHeader(99, 10)];
            expect(() => {
                testDecodeRect(decoder, 0, 0, 4, 4, data, display, 24);
            }).to.throw(/Unknown ATEN_HERMON type: 99/);
        });

        it('decodes a 4×2 RAW green rect to RGBX32', function () {
            display.resize(4, 4);

            // 4×2 pixels, all green.  Payload = 16 bytes.
            const pixelBytes = [];
            for (let i = 0; i < 8; ++i) { pixelBytes.push(...rgb555(0, 31, 0)); }

            // Outer payloadLen = sub-header (10) + RAW payload (16) = 26
            const data = [
                ...outerHeader(26),
                ...subHeader(1, 26),
                ...pixelBytes,
            ];
            const done = testDecodeRect(decoder, 0, 0, 4, 2, data, display, 24);
            expect(done).to.be.true;

            // First two rows: green; rows 2-3 untouched (default black).
            const green = [0x00, 0xFF, 0x00, 0xFF];
            // Untouched canvas pixels are transparent black (alpha=0),
            // not opaque (alpha=255).
            const black = [0x00, 0x00, 0x00, 0x00];
            const expected = new Uint8Array(4 * 4 * 4);
            for (let py = 0; py < 4; ++py) {
                for (let px = 0; px < 4; ++px) {
                    const off = (py * 4 + px) * 4;
                    const color = (py < 2) ? green : black;
                    expected.set(color, off);
                }
            }
            expect(display).to.have.displayed(expected);
        });

        it('decodes a single 16×16 red subrect', function () {
            display.resize(32, 32);

            // One 16×16 subrect of pure red at tile (0, 0).
            const pixelBytes = [];
            for (let i = 0; i < 256; ++i) { pixelBytes.push(...rgb555(31, 0, 0)); }
            // Subrect record: [u16 a][u16 b][u8 y][u8 x] + 512 bytes
            const subrect = [
                0, 0,  0, 0,         // a, b
                0,                    // ty
                0,                    // tx
                ...pixelBytes,
            ];
            // Outer payloadLen = 10 + 518 = 528
            const data = [
                ...outerHeader(528),
                ...subHeader(0, 528, 1),
                ...subrect,
            ];
            const done = testDecodeRect(decoder, 0, 0, 32, 32, data, display, 24);
            expect(done).to.be.true;

            // Verify upper-left 16×16 region is red; the rest is black.
            const red = [0xFF, 0x00, 0x00, 0xFF];
            // Untouched canvas pixels are transparent black (alpha=0),
            // not opaque (alpha=255).
            const black = [0x00, 0x00, 0x00, 0x00];
            const expected = new Uint8Array(32 * 32 * 4);
            for (let py = 0; py < 32; ++py) {
                for (let px = 0; px < 32; ++px) {
                    const off = (py * 32 + px) * 4;
                    const color = (py < 16 && px < 16) ? red : black;
                    expected.set(color, off);
                }
            }
            expect(display).to.have.displayed(expected);
        });
    });
});
