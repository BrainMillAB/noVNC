/*
 * Unit tests for the ATEN AST2100 wrapper decoder (core/decoders/
 * aten_ast2100.js).  These exercise the thin framing layer that sits
 * between the RFB framebuffer-update dispatch and the full bit-stream
 * AST2100 decoder package in core/ast2100/.
 *
 * The bit-stream decoder itself is covered by tests/test.aten_ast2100.js
 * (same-named prefix, different suffix — carried over from the fork).
 */

import Websock from '../core/websock.js';
import Display from '../core/display.js';
import ATENAST2100Decoder from '../core/decoders/aten_ast2100.js';
import FakeWebSocket from './fake.websocket.js';

const SCREEN_OFF_W = 64896;
const SCREEN_OFF_H = 65056;

function u32(v) {
    return [
        (v >>> 24) & 0xff, (v >>> 16) & 0xff,
        (v >>>  8) & 0xff,  v         & 0xff,
    ];
}

// Outer header: mysteryFlag (ignored) + payloadLen.
function outerHeader(payloadLen, mysteryFlag = 0) {
    return [...u32(mysteryFlag), ...u32(payloadLen)];
}

function parseHex(s) {
    s = s.replace(/\s/g, '');
    const bytes = [];
    for (let i = 0; i < s.length; i += 2) {
        bytes.push(parseInt(s.substr(i, 2), 16));
    }
    return bytes;
}

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

describe('ATEN AST2100 wrapper decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new ATENAST2100Decoder();
        display = new Display(document.createElement('canvas'));
        display.resize(32, 32);
    });

    describe('screen-off / empty-payload handling', function () {
        it('handles the screen-off marker with zero payload', function () {
            const data = outerHeader(0);
            const done = testDecodeRect(decoder, 0, 0,
                SCREEN_OFF_W, SCREEN_OFF_H, data, display, 24);
            expect(done).to.be.true;
        });

        it('handles the screen-off marker with a non-zero payload (drained)', function () {
            // Some ATEN firmware still sends 10 drainable bytes in
            // screen-off notifications.
            const filler = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const data = [...outerHeader(10), ...filler];
            const done = testDecodeRect(decoder, 0, 0,
                SCREEN_OFF_W, SCREEN_OFF_H, data, display, 24);
            expect(done).to.be.true;
        });

        it('returns idle on aten_len=0 outside the screen-off marker', function () {
            // Empty payload, normal dimensions — seen around display-off
            // transitions (machine restarting, etc.).
            const data = outerHeader(0);
            const done = testDecodeRect(decoder, 0, 0, 640, 480, data, display, 24);
            expect(done).to.be.true;
        });
    });

    describe('partial-input resumability', function () {
        it('returns false when only the first 4 bytes of the header are available', function () {
            const sock = new Websock();
            sock.open('ws://example.com');
            sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
            const done = decoder.decodeRect(0, 0, 640, 480, sock, display, 24);
            expect(done).to.be.false;
        });

        it('resumes cleanly once the full header arrives', function () {
            const sock = new Websock();
            sock.open('ws://example.com');

            // First chunk: only 4 bytes of the 8-byte header.
            sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
            let done = decoder.decodeRect(0, 0, 640, 480, sock, display, 24);
            expect(done).to.be.false;

            // Second chunk: remaining 4 bytes (payloadLen=0).
            sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
            done = decoder.decodeRect(0, 0, 640, 480, sock, display, 24);
            expect(done).to.be.true;
        });
    });

    describe('end-to-end decode', function () {
        it('forwards the payload into Ast2100Decoder and emits blits', function () {
            // Captured AST2100 bit-stream fragment (same payload the
            // bit-stream tests in test.aten_ast2100.js use), wrapped in
            // the 8-byte ATEN outer header.
            const payload = parseHex(
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

            // Count how often the display is blitted by wrapping the
            // native blitImage method.
            let blitCount = 0;
            const origBlit = display.blitImage.bind(display);
            display.blitImage = (...args) => { ++blitCount; origBlit(...args); };

            const data = [...outerHeader(payload.length), ...payload];
            const done = testDecodeRect(decoder, 0, 0, 1024, 768, data, display, 24);

            expect(done).to.be.true;
            expect(blitCount).to.be.above(0,
                'Ast2100Decoder should have emitted at least one blit');
        });

        it('survives a second frame on the same decoder instance', function () {
            // Decoder state is persistent across frames (quant tables,
            // subsampling mode, codebook).  A second decode must work
            // without re-constructing the inner decoder.
            const payload = parseHex(
                '040701a61bff6280f81fbaa2ff4dbc408dfccf405c15ff1f' +
                '004800f500000000000000002dd4a462237ced2c9c25dca4');
            const data = [...outerHeader(payload.length), ...payload];

            let done = testDecodeRect(decoder, 0, 0, 1024, 768, data, display, 24);
            expect(done).to.be.true;
            done = testDecodeRect(decoder, 0, 0, 1024, 768, data, display, 24);
            expect(done).to.be.true;
        });
    });
});
