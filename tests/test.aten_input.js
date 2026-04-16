/*
 * Unit tests for ATEN iKVM input helpers:
 *   - core/input/aten_hid.js   (XK2HID translation table)
 *   - RFB.messages.atenKeyEvent / atenPointerEvent wire formats
 *
 * The sendKey / _sendMouse dispatch branches are covered indirectly in
 * test.rfb.js, where a connected client is flipped into atenikvm mode
 * and its socket's sent bytes are asserted.
 */

import Websock from '../core/websock.js';
import RFB from '../core/rfb.js';
import KeyTable from '../core/input/keysym.js';
import ATENXK2HID from '../core/input/aten_hid.js';
import FakeWebSocket from './fake.websocket.js';

function makeSock() {
    const websock = new FakeWebSocket();
    websock._open();
    const sock = new Websock();
    sock.attach(websock);
    return sock;
}

describe('ATEN XK2HID table', function () {
    it('maps A through Z to HID 0x04..0x1D', function () {
        for (let offset = 0; offset <= 25; ++offset) {
            expect(ATENXK2HID[KeyTable.XK_A + offset]).to.equal(0x04 + offset);
        }
    });

    it('maps lowercase a through z to the same scancodes as uppercase', function () {
        for (let offset = 0; offset <= 25; ++offset) {
            expect(ATENXK2HID[KeyTable.XK_a + offset])
                .to.equal(ATENXK2HID[KeyTable.XK_A + offset]);
        }
    });

    it('maps digits 1..9 to HID 0x1E..0x26', function () {
        for (let offset = 0; offset < 9; ++offset) {
            expect(ATENXK2HID[KeyTable.XK_1 + offset]).to.equal(0x1e + offset);
        }
    });

    it('maps F1..F12 to HID 0x3A..0x45', function () {
        for (let offset = 0; offset < 12; ++offset) {
            expect(ATENXK2HID[KeyTable.XK_F1 + offset]).to.equal(0x3a + offset);
        }
    });

    it('maps common control keys', function () {
        expect(ATENXK2HID[KeyTable.XK_Return]).to.equal(0x28);
        expect(ATENXK2HID[KeyTable.XK_Escape]).to.equal(0x29);
        expect(ATENXK2HID[KeyTable.XK_Tab]).to.equal(0x2b);
        expect(ATENXK2HID[KeyTable.XK_BackSpace]).to.equal(0x2a);
        expect(ATENXK2HID[KeyTable.XK_space]).to.equal(0x2c);
        expect(ATENXK2HID[KeyTable.XK_Delete]).to.equal(0x4c);
    });

    it('maps modifiers with L/R aliasing', function () {
        expect(ATENXK2HID[KeyTable.XK_Control_L]).to.equal(0xe0);
        expect(ATENXK2HID[KeyTable.XK_Control_R]).to.equal(0xe0);
        expect(ATENXK2HID[KeyTable.XK_Shift_L]).to.equal(0xe1);
        expect(ATENXK2HID[KeyTable.XK_Shift_R]).to.equal(0xe1);
        expect(ATENXK2HID[KeyTable.XK_Alt_L]).to.equal(0xe2);
        expect(ATENXK2HID[KeyTable.XK_Alt_R]).to.equal(0xe2);
    });

    it('shifted US-ASCII punctuation maps to the unshifted physical key', function () {
        expect(ATENXK2HID[KeyTable.XK_exclam]).to.equal(ATENXK2HID[KeyTable.XK_1]);
        expect(ATENXK2HID[KeyTable.XK_at]).to.equal(ATENXK2HID[KeyTable.XK_2]);
        expect(ATENXK2HID[KeyTable.XK_underscore]).to.equal(ATENXK2HID[KeyTable.XK_minus]);
        expect(ATENXK2HID[KeyTable.XK_quotedbl]).to.equal(ATENXK2HID[KeyTable.XK_apostrophe]);
    });
});

describe('RFB.messages.atenKeyEvent', function () {
    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    it('emits 18 bytes with msg-type=4 and HID scancode from XK2HID', function () {
        const sock = makeSock();
        RFB.messages.atenKeyEvent(sock, KeyTable.XK_a, 1);
        // HID scancode for 'a' is 0x04 (big-endian u32 = 0 0 0 4).
        const expected = new Uint8Array([
            4,    // msg-type
            0,    // pad
            1,    // down
            0, 0, // pad
            0, 0, 0, 0x04, // HID scancode
            0, 0, 0, 0, 0, 0, 0, 0, 0, // 9 bytes pad
        ]);
        expect(sock).to.have.sent(expected);
    });

    it('encodes the press/release flag correctly', function () {
        const sock = makeSock();
        RFB.messages.atenKeyEvent(sock, KeyTable.XK_Escape, 0);
        const expected = new Uint8Array([
            4, 0, 0, 0, 0, 0, 0, 0, 0x29,    // Escape HID = 0x29
            0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        expect(sock).to.have.sent(expected);
    });

    it('sends zero-filled HID bytes for an unknown keysym', function () {
        const sock = makeSock();
        RFB.messages.atenKeyEvent(sock, 0x42424242, 1); // not in XK2HID
        const expected = new Uint8Array([
            4, 0, 1, 0, 0, 0, 0, 0, 0, // HID all-zero
            0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        expect(sock).to.have.sent(expected);
    });
});

describe('RFB.messages.atenPointerEvent', function () {
    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    it('emits 18 bytes with msg-type=5, padded mask, and coords', function () {
        const sock = makeSock();
        RFB.messages.atenPointerEvent(sock, 0x1234, 0x5678, 0x01);
        const expected = new Uint8Array([
            5,          // msg-type
            0,          // pad
            0x01,       // button mask
            0x12, 0x34, // x (big-endian)
            0x56, 0x78, // y
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 11 bytes pad
        ]);
        expect(sock).to.have.sent(expected);
    });

    it('masks off the high marker bit from the button mask', function () {
        const sock = makeSock();
        RFB.messages.atenPointerEvent(sock, 0, 0, 0xff);
        const expected = new Uint8Array([
            5, 0, 0x7f,    // marker bit cleared → 0x7f
            0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
        expect(sock).to.have.sent(expected);
    });
});
