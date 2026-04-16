/*
 * Unit tests for the AST2100 decoder package (core/ast2100/*).
 * Ported from kelleyk/noVNC#bmc-support tests/test.ast2100.js.
 *
 * All inputs are small synthetic byte sequences or captured fragments
 * from real ATEN frames, carried forward verbatim from the fork so that
 * the ported package produces byte-identical output where the fork did.
 *
 * A full-frame captured AST2100 fixture lives at tests/data/aten/
 * frame4.hex (72 KB).  It is NOT exercised by these tests yet — the
 * fork never wired it in (the full-frame test was commented out and
 * depended on jQuery).  The fixture is carried forward here for future
 * end-to-end tests in stages 4.8 / 4.9.
 */

import Ast2100Decoder   from '../core/ast2100/ast2100.js';
import AST2100IDCT      from '../core/ast2100/ast2100idct.js';
import {
    BitStream,
    fmt_u8a,
    fmt_rgb_buf,
} from '../core/ast2100/ast2100util.js';
import {
    DCTSIZE2,
    ATEN_QT_LUMA,
} from '../core/ast2100/ast2100const.js';

// Convert a hex string, optionally containing spaces, into a Uint8Array.
function parseHex(s) {
    s = s.replace(/\s/g, '');
    if (s.length % 2 !== 0) { throw new Error('Hex data has uneven length!'); }
    const bytes = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) {
        bytes[i / 2] = parseInt(s.substr(i, 2), 16);
    }
    return bytes;
}

// Swap u32 byte order.  Mutates input.
function buf_swap32(data) {
    for (let i = 0; i < data.length; i += 4) {
        let tmp;
        tmp = data[i + 0]; data[i + 0] = data[i + 3]; data[i + 3] = tmp;
        tmp = data[i + 1]; data[i + 1] = data[i + 2]; data[i + 2] = tmp;
    }
    return data;
}

function makeDecoder() {
    return new Ast2100Decoder({
        width: 0x400,
        height: 0x300,
        blitCallback: () => {},
    });
}

describe('ATEN_AST2100 video encoding', function () {
    let dec;

    beforeEach(function () {
        dec = makeDecoder();
    });

    describe('BitStream', function () {
        let stream, stream2, stream3;
        const data  = buf_swap32(parseHex('f0f0 cccc cccc cccc cccc cccc cccc cccc'));
        const data2 = parseHex('F0F1F2F3 F4F5F6F7 F8F9FAFB FCFDFEFF');
        const data3 = parseHex('0b0b01bc45fbc5e020040101ffff3f20c0ffffff0000240000000000000000005028140a0000000000000000');

        beforeEach(function () {
            stream  = new BitStream({data: data});
            stream2 = new BitStream({data: data2});
            stream3 = new BitStream({data: data3});
        });

        it('should pass simple sanity checks', function () {
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(4)).to.equal(0x0);
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(4)).to.equal(0x0);
        });

        it('should pass simple sanity checks (part II)', function () {
            for (let i = 0; i < 4; ++i) { expect(stream.read(1)).to.equal(1); }
            for (let i = 0; i < 4; ++i) { expect(stream.read(1)).to.equal(0); }
        });

        it('should be able to properly refill the buffer', function () {
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(4)).to.equal(0x0);
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(8)).to.equal(0x0C);
        });

        it('should properly swap byte order', function () {
            expect(stream2.read(8)).to.equal(0xF3);
            expect(stream2.read(8)).to.equal(0xF2);
            expect(stream2.read(8)).to.equal(0xF1);
            expect(stream2.read(8)).to.equal(0xF0);
            expect(stream2.read(8)).to.equal(0xF7);
        });

        it('should properly handle skipping the full 32-bit read-buffer (data3)', function () {
            // Two parts because read() is limited to < 32 bits.
            stream3.skip(16);
            stream3.skip(16);
            expect(stream3.read(4)).to.equal(0xE);
        });
    });

    describe('quant tables', function () {
        it('loads and scales luma quant table #4 correctly', function () {
            const expected = Int32Array.from([
                0x00090000, 0x0008527e, 0x00068866, 0x000a9537, 0x000d0000, 0x00114908, 0x000f274b, 0x0009616d,
                0x0008527e, 0x000b8b14, 0x000caf8f, 0x00104f53, 0x00136b26, 0x0022df8f, 0x0018c594, 0x000b7b02,
                0x0009255c, 0x000caf8f, 0x000f5d2c, 0x0013f8fd, 0x001cbe90, 0x0020d994, 0x001adebc, 0x000b2cc4,
                0x00083b2b, 0x000eadca, 0x00126faf, 0x00161f78, 0x0020ecad, 0x002c58a1, 0x001ca316, 0x000b07c7,
                0x000a0000, 0x0010a4fc, 0x001a219a, 0x002473bf, 0x00260000, 0x002fed69, 0x001ed922, 0x000bdd19,
                0x000a36ca, 0x0014b4bd, 0x001ecbfa, 0x00214279, 0x00235b34, 0x0023cdea, 0x001ac9de, 0x000b0e2f,
                0x000e9cbf, 0x001b0616, 0x001e67d4, 0x001e8bd4, 0x001ed922, 0x001cea24, 0x00139fb4, 0x00085c96,
                0x000b0935, 0x00138450, 0x00131afd, 0x0011d7e1, 0x001161b4, 0x000c23a7, 0x000882d0, 0x00042fc6,
            ]);
            dec._loadQuantTable(0, ATEN_QT_LUMA[4]);
            expect(dec.quantTables[0]).to.deep.equal(expected);
        });
    });

    describe('IDCT', function () {
        let outputBuf;
        beforeEach(function () {
            outputBuf = new Uint8Array(DCTSIZE2);
        });

        it('test case 0 — DC value only', function () {
            // VLC/entropy-decoded coefficients.  DC value in [0], AC all 0.
            const dataUnit = Int16Array.from([
                0xFF9C, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
            ]);
            const expected = Uint8Array.from([
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
                0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF,
            ]);
            dec._loadQuantTable(0, ATEN_QT_LUMA[4]);
            AST2100IDCT.idct_fixed_aan(dec.quantTables[0], dataUnit, outputBuf);
            expect(outputBuf).to.deep.equal(expected);
        });

        it('test case 1', function () {
            const dataUnit = Int16Array.from([
                0xFFBD, 0, 0, 0, 0, 0, 0, 0,
                0xFFC3, 0, 0, 0, 0, 0, 0, 0,
                0x26,   0, 0, 0, 0, 0, 0, 0,
                0xFFED, 0, 0, 0, 0, 0, 0, 0,
                0,      0, 0, 0, 0, 0, 0, 0,
                6,      0, 0, 0, 0, 0, 0, 0,
                0xFFFC, 0, 0, 0, 0, 0, 0, 0,
                2,      0, 0, 0, 0, 0, 0, 0,
            ]);
            const expected = Uint8Array.from([
                0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F,
                0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
                0x12, 0x12, 0x12, 0x12, 0x12, 0x12, 0x12, 0x12,
                0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E,
                0x12, 0x12, 0x12, 0x12, 0x12, 0x12, 0x12, 0x12,
                0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F,
                0x9F, 0x9F, 0x9F, 0x9F, 0x9F, 0x9F, 0x9F, 0x9F,
                0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1,
            ]);
            dec._loadQuantTable(0, ATEN_QT_LUMA[4]);
            AST2100IDCT.idct_fixed_aan(dec.quantTables[0], dataUnit, outputBuf);
            let maxErr = 0;
            for (let i = 0; i < 64; ++i) {
                maxErr = Math.max(maxErr, Math.abs(outputBuf[i] - expected[i]));
            }
            expect(maxErr).to.be.at.most(1,
                'IDCT output differs from expected by more than 1 at max; buf=' + fmt_u8a(outputBuf));
        });

        it('test case 2', function () {
            const dataUnit = Int16Array.from([
                0xFF9B, 0,    0, 0, 0, 0, 0, 0,
                0xFFA4, 0,    0, 0, 0, 0, 0, 0,
                0x35,   0,    0, 0, 0, 0, 0, 0,
                0xFFE6, 0,    0, 0, 0, 0, 0, 0,
                0,      0,    0, 0, 0, 0, 0, 0,
                9,      0,    0, 0, 0, 0, 0, 0,
                0xFFFA, 0,    0, 0, 0, 0, 0, 0,
                2,      0,    0, 0, 0, 0, 0, 0,
            ]);
            const expected = Uint8Array.from([
                0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E,
                0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13,
                0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D,
                0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13,
                0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D,
                0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14,
                0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0x9C,
                0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1,
            ]);
            dec._loadQuantTable(0, ATEN_QT_LUMA[5]);
            AST2100IDCT.idct_fixed_aan(dec.quantTables[0], dataUnit, outputBuf);
            let maxErr = 0;
            for (let i = 0; i < 64; ++i) {
                maxErr = Math.max(maxErr, Math.abs(outputBuf[i] - expected[i]));
            }
            expect(maxErr).to.be.at.most(1,
                'IDCT output differs from expected by more than 1 at max; buf=' + fmt_u8a(outputBuf));
        });
    });

    describe('VQ', function () {
        it('should successfully load a codebook (colors)', function () {
            // Snapshot from a real ATEN capture: includes quant-table +
            // subsampling-mode preamble, then VQ block data.
            let data = buf_swap32(parseHex(
                'bc010b0b e0c5fb45 01010420 203fffff ffffffc0 00240000 00000000 00000000 0a142850'));
            data = data.slice(4);

            const stream = new BitStream({data: data});
            const controlFlag = stream.read(4);
            expect(controlFlag).to.equal(0xE);

            const xMcuPos = stream.read(8);
            const yMcuPos = stream.read(8);
            expect(xMcuPos).to.equal(0xC);
            expect(yMcuPos).to.equal(0x5F);

            dec.subsamplingMode = 444; // required, else an assertion inside VQ fails
            dec._stream = stream;
            dec._parseVqBlock(1); // codewordSize = 1

            expect(dec._vqCodewordLookup).to.deep.equal([1, 0, 2, 3]);
            expect(dec._vqCodebook).to.deep.equal([
                [0x10, 0x80, 0x80],
                [0xA2, 0x80, 0x80],
                [0x80, 0x80, 0x80],
                [0xC0, 0x80, 0x80],
            ]);
        });

        it('should correctly handle multiple data blocks', function () {
            // Two VQ (0xE-type) blocks followed by a 0x9 end-of-frame.
            const data = buf_swap32(parseHex(
                'bc010b0b e0c5fb45 01010420 203fffff ffffffc0 00240000 00000000 00000000 0a142850' +
                '00000000 00000000'));
            dec.decode(data);
            // Smoke test: reaching the end-of-frame marker without
            // throwing is the assertion.
        });
    });

    describe('Full JPEG subsampled MCU example', function () {
        it('should decode without throwing', function () {
            // Captured fragment — exercises a mix of block types.
            const data = parseHex(
                '040701a61bff6280f81fbaa2ff4dbc408dfccf405c15ff1f' +
                '004800f500000000000000002dd4a462237ced2c9c25dca4' +
                'cef7e6667d6626f3308063c3c7a1b7335badc24aaf0b5e9d' +
                'af69590fcb96206b59e6f2ccb2bdd386b17dbb72182080d6' +
                '288a2a1f2f0608a0fe87ae287f132f1023ff33d057c5ff47' +
                '0012403d0000000000000000ec1fb06cdacd2bdf9d79f3cd' +
                'e7f9f1362b7ce914ba521c79524a5bdc212a5ed47c3cbc6c' +
                '7e072ae3e3c18384785f6ca6d4e22fb1af0c96449d1847a9' +
                'c7037e966fa3ac8d4990830339463d277f25fc6f30ffe5f4' +
                'f5cfec9f4ffff8bf00a0f5d358a2ab6e4e6778d929f686bd' +
                '58ca9c26b8f7338f15105065dd39c718e219a78e');

            let blitCount = 0;
            dec._blitCallback = () => { ++blitCount; };
            dec.decode(data);
            expect(blitCount).to.be.above(0);
        });
    });

    describe('Frame update decode', function () {
        it('should decode a small frame-update payload', function () {
            const data = parseHex('050501a69a3f6080008aa2a8000000900000000000000000');
            let blitCount = 0;
            dec._blitCallback = () => { ++blitCount; };
            dec.decode(data);
            // Smoke test; this payload is sparse and may produce zero
            // or more blits.  Reaching end-of-frame without throwing
            // is the assertion.
            expect(blitCount).to.be.at.least(0);
        });
    });

    // fmt_rgb_buf is exercised via the decoder when verboseDebug is on;
    // a placeholder reference silences lint on the unused import.
    void fmt_rgb_buf;
});
