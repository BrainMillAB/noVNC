/*
 * noVNC: HTML5 VNC client — DOM `code` -> USB HID Usage Table map
 * for the ATEN iKVM keyboard wire format.
 *
 * The browser's keyboard events carry two relevant identifiers:
 *
 *   event.key   — the character produced, layout-aware.  E.g., on a
 *                 Swedish keyboard pressing the "-" key gives key="-",
 *                 on a US keyboard the key at that physical position
 *                 gives key="/".
 *
 *   event.code  — the PHYSICAL key identifier, layout-INdependent.
 *                 Both Swedish and US users pressing that same
 *                 physical key get code="Slash" regardless of the
 *                 character their OS decodes.
 *
 * For the ATEN path we want to ship USB HID scancodes that describe
 * physical key positions, so the guest OS applies its own keymap to
 * decode HID+modifier into a character.  Going from event.code is
 * therefore the correct route — it's the same logical layer the USB
 * HID spec operates on.  Going from keysym (our older XK2HID table)
 * is only approximate because keysyms vary with layout while HID
 * scancodes don't.
 *
 * This table covers USB HID Usage Page 0x07 (Keyboard/Keypad) across
 * the full set of DOM codes a typical desktop layout can emit — 104
 * keys plus numpad, internationals, and media / meta keys.  Values
 * from the USB HID Usage Tables document §10.
 */

const CodeToHID = {

    // Letters
    KeyA: 0x04, KeyB: 0x05, KeyC: 0x06, KeyD: 0x07, KeyE: 0x08,
    KeyF: 0x09, KeyG: 0x0a, KeyH: 0x0b, KeyI: 0x0c, KeyJ: 0x0d,
    KeyK: 0x0e, KeyL: 0x0f, KeyM: 0x10, KeyN: 0x11, KeyO: 0x12,
    KeyP: 0x13, KeyQ: 0x14, KeyR: 0x15, KeyS: 0x16, KeyT: 0x17,
    KeyU: 0x18, KeyV: 0x19, KeyW: 0x1a, KeyX: 0x1b, KeyY: 0x1c,
    KeyZ: 0x1d,

    // Digits (top row)
    Digit1: 0x1e, Digit2: 0x1f, Digit3: 0x20, Digit4: 0x21,
    Digit5: 0x22, Digit6: 0x23, Digit7: 0x24, Digit8: 0x25,
    Digit9: 0x26, Digit0: 0x27,

    // Text / control
    Enter:      0x28,
    Escape:     0x29,
    Backspace:  0x2a,
    Tab:        0x2b,
    Space:      0x2c,

    // Punctuation at US positions (physical positions are the same on
    // ISO-105 layouts; only the labelled characters differ).
    Minus:         0x2d,
    Equal:         0x2e,
    BracketLeft:   0x2f,
    BracketRight:  0x30,
    Backslash:     0x31,
    Semicolon:     0x33,
    Quote:         0x34,
    Backquote:     0x35,
    Comma:         0x36,
    Period:        0x37,
    Slash:         0x38,

    // Caps Lock
    CapsLock:      0x39,

    // Function keys
    F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d, F5: 0x3e, F6: 0x3f,
    F7: 0x40, F8: 0x41, F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45,
    F13: 0x68, F14: 0x69, F15: 0x6a, F16: 0x6b, F17: 0x6c, F18: 0x6d,
    F19: 0x6e, F20: 0x6f, F21: 0x70, F22: 0x71, F23: 0x72, F24: 0x73,

    // Navigation / editing cluster
    PrintScreen:   0x46,
    ScrollLock:    0x47,
    Pause:         0x48,
    Insert:        0x49,
    Home:          0x4a,
    PageUp:        0x4b,
    Delete:        0x4c,
    End:           0x4d,
    PageDown:      0x4e,
    ArrowRight:    0x4f,
    ArrowLeft:     0x50,
    ArrowDown:     0x51,
    ArrowUp:       0x52,

    // Numeric keypad
    NumLock:       0x53,
    NumpadDivide:  0x54,
    NumpadMultiply:0x55,
    NumpadSubtract:0x56,
    NumpadAdd:     0x57,
    NumpadEnter:   0x58,
    Numpad1:       0x59, Numpad2: 0x5a, Numpad3: 0x5b,
    Numpad4:       0x5c, Numpad5: 0x5d, Numpad6: 0x5e,
    Numpad7:       0x5f, Numpad8: 0x60, Numpad9: 0x61,
    Numpad0:       0x62,
    NumpadDecimal: 0x63,
    NumpadEqual:   0x67,
    NumpadComma:   0x85,

    // ISO non-US backslash — the "<>|" key on Swedish / German /
    // French / UK ISO keyboards between LShift and Z.  This is the
    // physical position that has NO analogue on ANSI-104.
    IntlBackslash: 0x64,

    // Context menu key
    ContextMenu:   0x65,

    // Power / sleep / wake on desktop keyboards
    Power:         0x66,

    // Japanese / Korean / international keys (HID Usage Page 0x07)
    IntlRo:        0x87,
    KanaMode:      0x88,
    IntlYen:       0x89,
    Convert:       0x8a,
    NonConvert:    0x8b,
    Lang1:         0x90,
    Lang2:         0x91,
    Lang3:         0x92,
    Lang4:         0x93,

    // Modifier keys — USB HID Usage IDs 0xE0..0xE7.  ATEN's keyboard
    // report carries these in the same 18-byte KeyEvent format as
    // regular keys; the BMC decodes the usage ID into the
    // corresponding modifier bit in the USB HID report it synthesises
    // toward the guest.
    ControlLeft:   0xe0,
    ShiftLeft:     0xe1,
    AltLeft:       0xe2,
    MetaLeft:      0xe3,
    ControlRight:  0xe4,
    ShiftRight:    0xe5,
    AltRight:      0xe6,
    MetaRight:     0xe7,

    // OS-specific alt-names for the Meta keys — Chromium on some
    // platforms emits OSLeft / OSRight rather than MetaLeft / Right.
    OSLeft:        0xe3,
    OSRight:       0xe7,
};

export default CodeToHID;
