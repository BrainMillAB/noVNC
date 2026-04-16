/*
 * noVNC: HTML5 VNC client — X keysym → USB HID scancode map for ATEN
 * iKVM BMCs.
 *
 * ATEN BMCs speak their own keyboard wire format that carries USB HID
 * scancodes rather than standard VNC keysyms.  RFB.messages.atenKeyEvent
 * uses this table to translate the keysym the noVNC keyboard stack
 * produces into the HID scancode ATEN expects.
 *
 * Ported from kelleyk/noVNC#bmc-support (core/input/keysym.js tail);
 * the scancode values are the standard HID Usage Table for Desktop
 * Keyboards (Usage Page 0x07).
 */

import KeyTable from './keysym.js';

const XK2HID = {};

// Function keys F1–F12  → HID 0x3A–0x45
for (let i = KeyTable.XK_F1; i <= KeyTable.XK_F12; ++i) {
    XK2HID[i] = 0x3a + (i - KeyTable.XK_F1);
}

// A–Z / a–z  → HID 0x04–0x1D (both cases map to same scancode)
for (let i = KeyTable.XK_A; i <= KeyTable.XK_Z; ++i) {
    const hid = 0x04 + (i - KeyTable.XK_A);
    XK2HID[i] = hid;
    XK2HID[i + (KeyTable.XK_a - KeyTable.XK_A)] = hid;
}

// Digits 1–9  → HID 0x1E–0x26
for (let i = KeyTable.XK_1; i <= KeyTable.XK_9; ++i) {
    XK2HID[i] = 0x1e + (i - KeyTable.XK_1);
}

// Single-value mappings
XK2HID[KeyTable.XK_0]            = 0x27;
XK2HID[KeyTable.XK_Return]       = 0x28;
XK2HID[KeyTable.XK_Escape]       = 0x29;
XK2HID[KeyTable.XK_BackSpace]    = 0x2a;
XK2HID[KeyTable.XK_Tab]          = 0x2b;
XK2HID[KeyTable.XK_space]        = 0x2c;
XK2HID[KeyTable.XK_minus]        = 0x2d;
XK2HID[KeyTable.XK_equal]        = 0x2e;
XK2HID[KeyTable.XK_bracketleft]  = 0x2f;
XK2HID[KeyTable.XK_bracketright] = 0x30;
XK2HID[KeyTable.XK_backslash]    = 0x31;
XK2HID[KeyTable.XK_semicolon]    = 0x33;
XK2HID[KeyTable.XK_apostrophe]   = 0x34;
XK2HID[KeyTable.XK_grave]        = 0x35;
XK2HID[KeyTable.XK_comma]        = 0x36;
XK2HID[KeyTable.XK_period]       = 0x37;
XK2HID[KeyTable.XK_slash]        = 0x38;

XK2HID[KeyTable.XK_Caps_Lock]    = 0x39;

XK2HID[KeyTable.XK_Print]        = 0x46;
XK2HID[KeyTable.XK_Scroll_Lock]  = 0x47;
XK2HID[KeyTable.XK_Pause]        = 0x48;
XK2HID[KeyTable.XK_Insert]       = 0x49;
XK2HID[KeyTable.XK_Home]         = 0x4a;
XK2HID[KeyTable.XK_Page_Up]      = 0x4b;
XK2HID[KeyTable.XK_Delete]       = 0x4c;
XK2HID[KeyTable.XK_End]          = 0x4d;
XK2HID[KeyTable.XK_Page_Down]    = 0x4e;
XK2HID[KeyTable.XK_Right]        = 0x4f;
XK2HID[KeyTable.XK_Left]         = 0x50;
XK2HID[KeyTable.XK_Down]         = 0x51;
XK2HID[KeyTable.XK_Up]           = 0x52;

// Modifiers: left + right variants share the same HID value so the
// BMC reports the modifier-byte bit identically regardless of which
// side was pressed.
XK2HID[KeyTable.XK_Control_L]    = 0xe0;
XK2HID[KeyTable.XK_Control_R]    = XK2HID[KeyTable.XK_Control_L];
XK2HID[KeyTable.XK_Shift_L]      = 0xe1;
XK2HID[KeyTable.XK_Shift_R]      = XK2HID[KeyTable.XK_Shift_L];
XK2HID[KeyTable.XK_Alt_L]        = 0xe2;
XK2HID[KeyTable.XK_Alt_R]        = XK2HID[KeyTable.XK_Alt_L];
XK2HID[KeyTable.XK_Super_L]      = 0xe3;
XK2HID[KeyTable.XK_Super_R]      = XK2HID[KeyTable.XK_Super_L];

// Shifted US-ASCII punctuation mapped to their unshifted physical key.
// The BMC does not see the shifted variants; the shift bit comes from
// the modifier scancode emitted alongside.  This is a US-layout
// hardcoding lifted verbatim from the fork — a proper IME-aware port
// would derive the physical key via DOM `code` instead.
XK2HID[KeyTable.XK_less]         = XK2HID[KeyTable.XK_comma];
XK2HID[KeyTable.XK_greater]      = XK2HID[KeyTable.XK_period];
XK2HID[KeyTable.XK_exclam]       = XK2HID[KeyTable.XK_1];
XK2HID[KeyTable.XK_at]           = XK2HID[KeyTable.XK_2];
XK2HID[KeyTable.XK_numbersign]   = XK2HID[KeyTable.XK_3];
XK2HID[KeyTable.XK_dollar]       = XK2HID[KeyTable.XK_4];
XK2HID[KeyTable.XK_percent]      = XK2HID[KeyTable.XK_5];
XK2HID[KeyTable.XK_asciicircum]  = XK2HID[KeyTable.XK_6];
XK2HID[KeyTable.XK_ampersand]    = XK2HID[KeyTable.XK_7];
XK2HID[KeyTable.XK_asterisk]     = XK2HID[KeyTable.XK_8];
XK2HID[KeyTable.XK_parenleft]    = XK2HID[KeyTable.XK_9];
XK2HID[KeyTable.XK_parenright]   = XK2HID[KeyTable.XK_0];
XK2HID[KeyTable.XK_underscore]   = XK2HID[KeyTable.XK_minus];
XK2HID[KeyTable.XK_bar]          = XK2HID[KeyTable.XK_backslash];
XK2HID[KeyTable.XK_quotedbl]     = XK2HID[KeyTable.XK_apostrophe];
XK2HID[KeyTable.XK_asciitilde]   = XK2HID[KeyTable.XK_grave];

export default XK2HID;
