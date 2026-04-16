/*
 * noVNC: HTML5 VNC client — ATEN AST2100 utility helpers
 *
 * Originally (c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>,
 * clean-room reverse-engineered for kelleyk/noVNC#bmc-support.
 *
 * Ported 2026 to ES modules for modern noVNC mainline by the BrainMillAB
 * team.  No algorithmic changes from the upstream fork — only the
 * module shape was adapted (IIFE + JSHint globals pragma -> named exports).
 */

//
// Number-format helpers.  Used by debug-logging paths; kept available as
// named exports for parity with the original fork's global scope.
//

export function fmt_u8(x) {
    const pad = '00';
    const s = x.toString(16);
    return pad.substring(0, pad.length - s.length) + s;
}

export function fmt_u16(x) {
    const pad = '0000';
    const s = x.toString(16);
    return pad.substring(0, pad.length - s.length) + s;
}

// Cheesy way to get around the sign bit.
export function fmt_u32(x) {
    return fmt_u16(x >>> 16) + fmt_u16(x & 0xFFFF);
}

export function fmt_s8(x) {
    if (x < 0) {
        x += (1 << 8);
    }
    return fmt_u8(x);
}

export function fmt_s16(x) {
    if (x < 0) {
        x += (1 << 16);
    }
    return fmt_u16(x);
}

export function fmt_s32(x) {
    if (x < 0) {
        x += (1 << 32);
    }
    return fmt_u32(x);
}

function fmt_array(f, xx) {
    // If xx is a typed array, the strings `f` returns would be silently
    // coerced back to numbers; Array.from() forces the join path.
    xx = Array.from(xx);
    return '[' + xx.map(f).join(', ') + ']';
}

export function fmt_u8a(xx)  { return fmt_array(fmt_u8,  xx); }
export function fmt_u16a(xx) { return fmt_array(fmt_u16, xx); }
export function fmt_u32a(xx) { return fmt_array(fmt_u32, xx); }
export function fmt_s8a(xx)  { return fmt_array(fmt_s8,  xx); }
export function fmt_s16a(xx) { return fmt_array(fmt_s16, xx); }
export function fmt_s32a(xx) { return fmt_array(fmt_s32, xx); }

export function fmt_rgb_buf(n, buf) {
    let s = "";
    for (let y = 0; y < n; ++y) {
        for (let x = 0; x < n; ++x) {
            const offset = ((y * n) + x) * 4;
            s += fmt_u8(buf[offset + 0]) + fmt_u8(buf[offset + 1]) +
                 fmt_u8(buf[offset + 2]) + fmt_u8(buf[offset + 3]) + ' ';
        }
        s += '\n';
    }
    return s;
}

//
// Range / equality helpers.
//

export function inRangeIncl(x, a, b) { return (x >= a && x <= b); }
export function inRange(x, a, b)     { return (x >= a && x <  b); }

export function swap32(val) {
    return ((val & 0xFF) << 24)
        | ((val & 0xFF00) << 8)
        | ((val >> 8) & 0xFF00)
        | ((val >> 24) & 0xFF);
}

export function arrayEq(a, b) {
    if (a.length !== b.length) { return false; }
    for (let i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
}

export function isEmpty(obj) {
    for (const prop in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, prop)) { return false; }
    }
    return true;
}

export function clamp(x) {
    x = ~~x;
    if (x <= 0)   { return 0;   }
    if (x >= 255) { return 255; }
    return x;
}

//
// BitStream — bit-level reader over a Uint8Array.  ATEN AST2100 scan
// data does NOT treat 0xFF bytes specially (unlike standard JPEG, which
// escapes them with 0x00 stuffing).
//

export class BitStream {
    constructor(defaults) {
        // ATEN scan data does not treat 0xFF bytes specially.
        this._interpretMarkers = false;
        // True iff we've encountered "end-of-image".
        this._eoi = false;

        this._data = defaults.data; // Uint8Array
        if (this._data === undefined) {
            throw new Error('BitStream constructor requires argument "data"!');
        }

        this._nextDword = 0;

        // Fill the readbuf and reservoir with the first two dwords in the
        // data buffer.
        this._reservoir = 0;
        this._bitsInReservoir = 0;
        this._refill();
        this._readbuf = this._reservoir;
        this._reservoir = 0;
        this._bitsInReservoir = 0;
        this._refill();
    }

    getPos() {
        return (this._nextDword * 32) - (32 + this._bitsInReservoir);
    }

    skip(bits) {
        while (bits > 0) {
            const n = Math.min(32, bits);
            this.read(n);
            bits -= n;
        }
    }

    read(bits) {
        // JavaScript's bitwise operators have this limitation.
        if (bits >= 32) {
            throw new Error('Number of bits must be less than 32.');
        }

        const moveFromReservoir = (n) => {
            this._readbuf = (this._readbuf << n) | (this._reservoir >>> (32 - n));
            this._reservoir <<= n;
            this._bitsInReservoir -= n;
        };

        const retval = this._readbuf >>> (32 - bits); // same as peek(bits)

        if (bits > this._bitsInReservoir) {
            bits -= this._bitsInReservoir;
            moveFromReservoir(this._bitsInReservoir);
            this._refill();
        }
        moveFromReservoir(bits);

        return retval;
    }

    _refill() {
        // N.B.: must use >>> for unsigned shift; >> is sra.
        if (this._bitsInReservoir !== 0) {
            throw new Error('Oops: in _refill(), bitsInReservoir=' +
                            this._bitsInReservoir);
        }
        for (let i = 0; i < 4; ++i) {
            const x = this._data[(4 * this._nextDword) + i];
            if (x === undefined) {
                throw new Error('BitStream overran available data!');
            }
            this._reservoir = (this._reservoir << 8) | x;
            this._bitsInReservoir += 8;
        }
        this._nextDword += 1;

        this._reservoir = swap32(this._reservoir);
    }

    peek(bits) {
        if (bits >= 32) {
            throw new Error('Number of bits must be less than 32.');
        }
        return this._readbuf >>> (32 - bits);
    }

    showDebug() {
        console.log('stream readbuf=' + fmt_u32(this._readbuf) +
                    ' reservoir=' + fmt_u32(this._reservoir) +
                    ' bitsLeft=' + this._bitsInReservoir + 'd' +
                    ' nextDword=' + fmt_u16(this._nextDword));
    }

    checkInvariants() {
        let err = null;
        if (this._bitsInReservoir < 0 || this._bitsInReservoir > 32) {
            err = 'Oops: BitStream invariant violated: bitsInReservoir=' +
                  this._bitsInReservoir;
        }
        if (err) {
            console.log(err);
            this.showDebug();
            throw new Error(err);
        }
    }
}

//
// JpegHuffmanTable — builds fixed-length lookup tables from a (BITS,
// HUFFVAL) pair.  `readCode(stream)` consumes up to 16 bits and returns
// the corresponding one-byte codeword.
//
// Reference: "Binary Tree Expansion of DHT"
// http://www.impulseadventure.com/photo/jpeg-huffman-coding.html
//

export class JpegHuffmanTable {
    constructor(defaults) {
        if (!defaults) { defaults = {}; }
        if (!defaults.bits || !defaults.huffval) {
            throw new Error('Arguments bits, huffval are required.');
        }

        this._huffsize = new Uint8Array(1 << 16);
        this._huffval_lookup = new Uint8Array(1 << 16);
        // Indices 1..16; element 0 is unused to make indexing nicer.
        this._bits = new Uint8Array(17);

        this._buildTables(defaults.bits, defaults.huffval);
    }

    _buildTables(bits, huffval) {
        for (let i = 0; i < 17; ++i) {
            this._bits[i] = bits[i];
            // Follows from the fact that the all-ones codeword of each
            // length is reserved as a prefix for longer codewords.
            if ((1 << i) <= bits[i]) {
                throw new Error('Oops: bad BITS.');
            }
        }

        let next_codeword = 0;
        let codeword_idx = 0;
        for (let code_len = 1; code_len < 17; ++code_len) {
            for (let i = 0; i < this._bits[code_len]; ++i) {
                for (let j = 0; j < (1 << (16 - code_len)); ++j) {
                    this._huffsize[next_codeword + j] = code_len;
                    this._huffval_lookup[next_codeword + j] = huffval[codeword_idx];
                }
                next_codeword += (1 << (16 - code_len));
                codeword_idx += 1;
            }
        }
        if (codeword_idx !== huffval.length) {
            throw new Error('Oops: all codewords should be used!');
        }
    }

    // Reads the next code from the stream.  Consumes up to 16 bits.
    // Returns the codeword (a one-byte value).
    readCode(stream) {
        const fixedlenCode = stream.peek(16); // uint16
        const codeLen = this._huffsize[fixedlenCode];
        stream.skip(codeLen);
        return this._huffval_lookup[fixedlenCode];
    }
}
