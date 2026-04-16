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

    describe('Nordic / German ISO layout extensions', function () {
        it('maps Swedish/Finnish å, ä, ö to their physical key HIDs', function () {
            expect(ATENXK2HID[KeyTable.XK_aring]).to.equal(0x2F);         // å at [ pos
            expect(ATENXK2HID[KeyTable.XK_Aring]).to.equal(0x2F);
            expect(ATENXK2HID[KeyTable.XK_adiaeresis]).to.equal(0x34);    // ä at ' pos
            expect(ATENXK2HID[KeyTable.XK_Adiaeresis]).to.equal(0x34);
            expect(ATENXK2HID[KeyTable.XK_odiaeresis]).to.equal(0x33);    // ö at ; pos
            expect(ATENXK2HID[KeyTable.XK_Odiaeresis]).to.equal(0x33);
        });

        it('maps Danish/Norwegian æ, ø to their physical key HIDs', function () {
            expect(ATENXK2HID[KeyTable.XK_ae]).to.equal(0x34);            // æ at ' pos
            expect(ATENXK2HID[KeyTable.XK_AE]).to.equal(0x34);
            expect(ATENXK2HID[KeyTable.XK_oslash]).to.equal(0x33);        // ø at ; pos
            expect(ATENXK2HID[KeyTable.XK_Ooblique]).to.equal(0x33);
        });

        it('maps German ü, ß to their physical key HIDs', function () {
            expect(ATENXK2HID[KeyTable.XK_udiaeresis]).to.equal(0x2F);    // ü at [ pos (shared with Nordic å)
            expect(ATENXK2HID[KeyTable.XK_Udiaeresis]).to.equal(0x2F);
            expect(ATENXK2HID[KeyTable.XK_ssharp]).to.equal(0x2D);        // ß at -_ pos
        });

        it('US-base mappings are untouched by the international additions', function () {
            // The US shifted-punctuation overrides must still work.
            expect(ATENXK2HID[KeyTable.XK_at]).to.equal(0x1F);            // US shift+2 = 2-key HID
            expect(ATENXK2HID[KeyTable.XK_Return]).to.equal(0x28);
            expect(ATENXK2HID[KeyTable.XK_a]).to.equal(0x04);
        });
    });

    describe('Spanish / Italian / Portuguese / Swiss ISO layout extensions', function () {
        it('maps Spanish-specific keysyms to their physical positions', function () {
            expect(ATENXK2HID[KeyTable.XK_ntilde]).to.equal(0x33);         // ñ at ; pos
            expect(ATENXK2HID[KeyTable.XK_Ntilde]).to.equal(0x33);
            expect(ATENXK2HID[KeyTable.XK_exclamdown]).to.equal(0x2E);     // ¡ at = pos
            expect(ATENXK2HID[KeyTable.XK_questiondown]).to.equal(0x2E);   // ¿ at shift-= pos
        });

        it('maps Italian unshifted accented vowels to their physical positions', function () {
            expect(ATENXK2HID[KeyTable.XK_egrave]).to.equal(0x2F);         // è at [ pos
            expect(ATENXK2HID[KeyTable.XK_ograve]).to.equal(0x33);         // ò at ; pos
            expect(ATENXK2HID[KeyTable.XK_agrave]).to.equal(0x34);         // à at ' pos
            expect(ATENXK2HID[KeyTable.XK_ugrave]).to.equal(0x32);         // ù at \ pos
            expect(ATENXK2HID[KeyTable.XK_igrave]).to.equal(0x2E);         // ì at = pos
        });

        it('maps Portuguese ç to the same physical position as Italian ò', function () {
            expect(ATENXK2HID[KeyTable.XK_ccedilla]).to.equal(0x33);
            expect(ATENXK2HID[KeyTable.XK_Ccedilla]).to.equal(0x33);
        });

        it('does NOT claim XK_eacute (conflicts Italian vs Swiss-French vs French)', function () {
            // docs/keyboard-layouts.md explains why.  Leaving it
            // unmapped means é still won't reach the BMC from a
            // Swiss/Italian user, but at least users on conflicting
            // layouts don't all break.
            expect(ATENXK2HID[KeyTable.XK_eacute]).to.equal(undefined);
        });

        it('leaves Nordic/German mappings intact', function () {
            // Sanity: the Nordic+German additions from the earlier
            // commit must still work after the Latin-South additions
            // above.  Shared HIDs (e.g. XK_ograve and XK_odiaeresis
            // both at 0x33) are fine because they're distinct
            // keysyms.
            expect(ATENXK2HID[KeyTable.XK_aring]).to.equal(0x2F);
            expect(ATENXK2HID[KeyTable.XK_odiaeresis]).to.equal(0x33);
            expect(ATENXK2HID[KeyTable.XK_udiaeresis]).to.equal(0x2F);
        });
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
