/*
 * noVNC: HTML5 VNC client — ATEN AST2100 top-level decoder.
 *
 * Clean-room reverse-engineered implementation.
 * (c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>.
 *
 * Ported to ES modules 2026 for modern noVNC mainline.  Algorithm is
 * byte-for-byte equivalent to kelleyk/noVNC#bmc-support — only the
 * module shape and local-variable scoping have been modernised.
 *
 * The decoder is driven by Ast2100Decoder#decode(data) with `data`
 * being the AST2100 payload bytes from a single FramebufferUpdate
 * rectangle.  On each decoded MCU it invokes the blitCallback with
 * (x, y, w, h, rgbxBytes) so the caller (core/decoders/aten_ast2100.js)
 * can forward it to the noVNC Display.
 */

import {
    DCTSIZE2, AAN_IDCT_SCALING_FACTORS, ZIGZAG_ORDER,
    ATEN_QT_LUMA, ATEN_QT_CHROMA,
    TABLE_CLASS_AC, TABLE_CLASS_DC,
    BITS_AC_LUMA, BITS_AC_CHROMA, BITS_DC_LUMA, BITS_DC_CHROMA,
    HUFFVAL_AC_LUMA, HUFFVAL_AC_CHROMA,
    HUFFVAL_DC_LUMA, HUFFVAL_DC_CHROMA,
    YUVTORGB_Y_TABLE,
    YUVTORGB_CB_B_TABLE, YUVTORGB_CB_G_TABLE,
    YUVTORGB_CR_R_TABLE, YUVTORGB_CR_G_TABLE,
} from './ast2100const.js';
import {
    BitStream, JpegHuffmanTable,
    inRangeIncl, isEmpty, clamp,
    fmt_u8, fmt_u16,
} from './ast2100util.js';
import AST2100IDCT from './ast2100idct.js';

// Debug switches — off in production, flip to true while tuning the port.
const verboseDebug         = false;
const verboseMcuCount      = false;
const traceUpdates         = false;
const verboseStats         = false;
const verboseVideoSettings = false;

export default class Ast2100Decoder {
    constructor(defaults) {
        this._blitCallback = defaults.blitCallback;
        this._videoSettingsChangedCallback = defaults.videoSettingsChangedCallback;
        this._frame_width  = defaults.width;
        this._frame_height = defaults.height;

        if (!this._frame_width || !this._frame_height) {
            throw new Error('Missing required parameter: width, height');
        }

        // Either 444u or 422u.  (The "422" mode is really 4:2:0 — chroma
        // subsampled by a factor of two in each direction.)  Applies
        // only to JPEG-ish blocks, not VQ blocks; VQ blocks seem to only
        // appear in 4:4:4 color mode.
        this.subsamplingMode = -1;

        this.quantTables = [new Int32Array(64), new Int32Array(64)];
        this._loadedQuantTables = [-1, -1];

        this.huffTables = [
            [new JpegHuffmanTable({bits: BITS_DC_LUMA,   huffval: HUFFVAL_DC_LUMA}),
             new JpegHuffmanTable({bits: BITS_DC_CHROMA, huffval: HUFFVAL_DC_CHROMA})],
            [new JpegHuffmanTable({bits: BITS_AC_LUMA,   huffval: HUFFVAL_AC_LUMA}),
             new JpegHuffmanTable({bits: BITS_AC_CHROMA, huffval: HUFFVAL_AC_CHROMA})],
        ];

        this._scan_components = [
            {huffTableSelectorDC: 0, huffTableSelectorAC: 0}, // Y
            {huffTableSelectorDC: 1, huffTableSelectorAC: 1}, // Cb
            {huffTableSelectorDC: 1, huffTableSelectorAC: 1}, // Cr
        ];
        this._scan_prev_dc = [0, 0, 0];

        this._mcuPosX = 0;
        this._mcuPosY = 0;

        this._initializeVq();

        // Allocated once and reused.  Hold entropy-decoded data before
        // dequantization + IDCT.
        this._tmpBufY = [
            new Int16Array(DCTSIZE2),
            new Int16Array(DCTSIZE2),
            new Int16Array(DCTSIZE2),
            new Int16Array(DCTSIZE2),
        ];
        this._tmpBufCb = new Int16Array(DCTSIZE2);
        this._tmpBufCr = new Int16Array(DCTSIZE2);

        // IDCT output.
        this._componentBufY = [
            new Uint8Array(DCTSIZE2),
            new Uint8Array(DCTSIZE2),
            new Uint8Array(DCTSIZE2),
            new Uint8Array(DCTSIZE2),
        ];
        this._componentBufCb = new Uint8Array(DCTSIZE2);
        this._componentBufCr = new Uint8Array(DCTSIZE2);

        // Final RGB output — noVNC expects groups of four bytes as
        // RGBA (alpha forced to 0xFF).
        this._outputBuf = new Uint8Array(DCTSIZE2 * 4);
    }

    _idct(quant_table, data_unit, dstBuf) {
        if (!quant_table) { throw new Error('Required argument missing: quant_table'); }
        if (!data_unit)   { throw new Error('Required argument missing: data_unit'); }
        if (!dstBuf)      { throw new Error('Required argument missing: dstBuf'); }
        return AST2100IDCT.idct_fixed_aan(quant_table, data_unit, dstBuf);
    }

    _getMcuSize() {
        return {444: 8, 422: 16}[this.subsamplingMode];
    }

    // Bakes in C(u)*C(v) and the cosine terms from the IDCT formula.
    _loadQuantTable(slot, srcTable) {
        for (let y = 0; y < 8; ++y) {
            for (let x = 0; x < 8; ++x) {
                this.quantTables[slot][y * 8 + x] =
                    ~~(srcTable[y * 8 + x]
                       * AAN_IDCT_SCALING_FACTORS[x]
                       * AAN_IDCT_SCALING_FACTORS[y]
                       * 65536.0);
            }
        }
    }

    _initializeVq() {
        // These colors are in YCbCr — black, white, and two shades of grey.
        this._vqCodewordLookup = [0, 1, 2, 3];
        this._vqCodebook = [
            [0x00, 0x80, 0x80],
            [0xFF, 0x80, 0x80],
            [0x80, 0x80, 0x80],
            [0xC0, 0x80, 0x80],
        ];
    }

    // Advance MCU cursor to the next position (raster order).
    _advancePosition() {
        const mcuSize = this._getMcuSize();
        let widthInMcus  = ~~(this._frame_width  / mcuSize);
        if (this._frame_width  % mcuSize !== 0) { widthInMcus  += 1; }
        let heightInMcus = ~~(this._frame_height / mcuSize);
        if (this._frame_height % mcuSize !== 0) { heightInMcus += 1; }

        this._mcuPosX += 1;
        if (this._mcuPosX >= widthInMcus) {
            this._mcuPosX = 0;
            this._mcuPosY += 1;
        }
        if (this._mcuPosY >= heightInMcus) {
            this._mcuPosY = 0;
        }
    }

    setSize(width, height) {
        if (this._frame_width !== width || this._frame_height !== height) {
            if (verboseDebug) {
                console.debug('Ast2100Decoder: frame size changed to ' +
                              width + 'x' + height);
            }
        }
        this._frame_width  = width;
        this._frame_height = height;
    }

    // Each quant-table selector is in [0, 0xB] (low→high quality).  ATEN
    // clients show a single quality slider driving both values.  The
    // server sends all three values with each FramebufferUpdate, so they
    // refresh every call to decode().
    getVideoSettings() {
        return {
            quantTableSelectorLuma:   this._loadedQuantTables[0],
            quantTableSelectorChroma: this._loadedQuantTables[1],
            subsamplingMode:          this.subsamplingMode,
        };
    }

    decode(data) {
        let mcuIdx = 0;
        let blockTypeCounter = null;
        if (verboseStats) { blockTypeCounter = new Array(16).fill(0); }

        // Reset between-frame state.
        this._scan_prev_dc = [0, 0, 0];
        this._mcuPosX = 0;
        this._mcuPosY = 0;

        // First four bytes carry per-frame tunables.
        const quantTableSelectorLuma   = data[0];                  // [0, 0xB]
        const quantTableSelectorChroma = data[1];                  // [0, 0xB]
        const subsamplingMode          = (data[2] << 8) | data[3]; // 422u or 444u

        let changedSettings = false;
        if (this.subsamplingMode !== subsamplingMode) {
            if (verboseVideoSettings) {
                console.log('decode(): new subsampling mode: ' + subsamplingMode);
            }
            this.subsamplingMode = subsamplingMode;
            changedSettings = true;
        }

        // The remainder of the stream is byte-swapped in four-byte
        // chunks — BitStream handles that.  Two 16-bit skips because the
        // read() cap is < 32 bits.
        this._stream = new BitStream({data: data});
        this._stream.skip(16);
        this._stream.skip(16);

        if (quantTableSelectorLuma !== this._loadedQuantTables[0]) {
            if (!inRangeIncl(quantTableSelectorLuma, 0, 0xB)) {
                throw new Error('Out-of-range selector for luma quant table: ' +
                                quantTableSelectorLuma.toString(16));
            }
            if (verboseVideoSettings) {
                console.log('decode(): loading new luma quant table: ' +
                            fmt_u8(quantTableSelectorLuma));
            }
            this._loadQuantTable(0, ATEN_QT_LUMA[quantTableSelectorLuma]);
            this._loadedQuantTables[0] = quantTableSelectorLuma;
            changedSettings = true;
        }
        if (quantTableSelectorChroma !== this._loadedQuantTables[1]) {
            if (!inRangeIncl(quantTableSelectorChroma, 0, 0xB)) {
                throw new Error('Out-of-range selector for chroma quant table: ' +
                                quantTableSelectorChroma.toString(16));
            }
            if (verboseVideoSettings) {
                console.log('decode(): loading new chroma quant table: ' +
                            fmt_u8(quantTableSelectorChroma));
            }
            this._loadQuantTable(1, ATEN_QT_CHROMA[quantTableSelectorChroma]);
            this._loadedQuantTables[1] = quantTableSelectorChroma;
            changedSettings = true;
        }

        if (this.subsamplingMode !== 422 && this.subsamplingMode !== 444) {
            throw new Error('Unexpected value for subsamplingMode: 0x' +
                            fmt_u16(this.subsamplingMode));
        }

        if (changedSettings && this._videoSettingsChangedCallback) {
            this._videoSettingsChangedCallback(this.getVideoSettings());
        }

        // Re-open the bit stream for the MCU loop (mirrors the fork; the
        // above reads only used the header).
        this._stream = new BitStream({data: data});
        this._stream.skip(16);
        this._stream.skip(16);

        for (;;) {
            const controlFlag = this._stream.read(4); // uint4

            if (verboseStats) { ++blockTypeCounter[controlFlag]; }
            if (verboseMcuCount) {
                console.log('MCU #' + mcuIdx + ' - control flag: ' +
                            controlFlag.toString(16));
                console.log('  stream pos = ' + this._stream.getPos());
            }

            if (controlFlag === 0 || controlFlag === 4 ||
                controlFlag === 8 || controlFlag === 0xC) {
                // JPEG-ish (DCT-compressed) data.
                if (controlFlag === 8 || controlFlag === 0xC) {
                    this._mcuPosX = this._stream.read(8); // uint8
                    this._mcuPosY = this._stream.read(8); // uint8
                    if (traceUpdates) {
                        console.log('decode(): read new MCU pos: (0x' +
                                    fmt_u8(this._mcuPosX) + ',0x' +
                                    fmt_u8(this._mcuPosY) + ')');
                    }
                }
                if (controlFlag === 4 || controlFlag === 0xC) {
                    // Haven't seen this feature in real traffic yet.
                    throw new Error('Unexpected control flag: alternate quant table');
                }
                // With 4:2:2 chroma subsampling on, read 6 blocks (4 Y,
                // 1 Cr, 1 Cb) → 16x16-pixel MCU.
                this._parseMcu();
            } else if (inRangeIncl(controlFlag, 5, 7) ||
                       inRangeIncl(controlFlag, 0xD, 0xF)) {
                // VQ-compressed data.
                if (controlFlag >= 0xD) {
                    this._mcuPosX = this._stream.read(8);
                    this._mcuPosY = this._stream.read(8);
                    if (traceUpdates) {
                        console.log('decode(): read new MCU pos: (0x' +
                                    fmt_u8(this._mcuPosX) + ',0x' +
                                    fmt_u8(this._mcuPosY) + ')');
                    }
                }
                const codewordSize = (controlFlag & 7) - 5; // 0..2
                this._parseVqBlock(codewordSize);
            } else if (controlFlag === 9) {
                // End-of-frame.
                break;
            } else {
                throw new Error('Unexpected control flag: unknown value 0x' +
                                fmt_u8(controlFlag));
            }
            ++mcuIdx;
        }

        if (traceUpdates) {
            console.log('decode(): finished after ' + mcuIdx + ' blocks');
        }
        if (verboseStats) {
            const counts = {};
            for (let i = 0; i < 16; ++i) {
                if (i !== 9 && blockTypeCounter[i] > 0) {
                    counts[i] = blockTypeCounter[i];
                }
            }
            if (!isEmpty(counts)) { console.log(counts); }
        }
    }

    //
    // _parseVqBlock:
    //  - always 8×8 (chroma subsampling does not apply to VQ-compressed
    //    data — VQ blocks only appear when DCT chroma subsampling is
    //    disabled, i.e. "444" mode)
    //  - reads 64 * codewordSize bits from the input stream
    //
    _parseVqBlock(codewordSize) {
        const mcuSize = this._getMcuSize();
        if (mcuSize !== 8) { throw new Error('Unexpected MCU size for VQ block!'); }
        if (!inRangeIncl(codewordSize, 0, 2)) {
            throw new Error('Out-of-range codewordSize!');
        }

        const y_buf  = this._componentBufY[0];
        const cb_buf = this._componentBufCb;
        const cr_buf = this._componentBufCr;

        const setColor = (j, codeword) => {
            const color = this._vqCodebook[this._vqCodewordLookup[codeword]];
            y_buf[j]  = color[0];
            cb_buf[j] = color[1];
            cr_buf[j] = color[2];
        };

        // Read codebook updates.  Each slot: 1-bit flag + 2-bit codebook
        // slot.  If flag is set, read 24 bits Y/Cb/Cr and store at the
        // slot.  Map the i-th codeword to the slot regardless.
        for (let i = 0; i < (1 << codewordSize); ++i) {
            const hasNewColor      = this._stream.read(1);
            const codebookSlotIdx  = this._stream.read(2);
            if (hasNewColor) {
                const color = [
                    this._stream.read(8),
                    this._stream.read(8),
                    this._stream.read(8),
                ];
                this._vqCodebook[codebookSlotIdx] = color;
            }
            this._vqCodewordLookup[i] = codebookSlotIdx;
        }

        // Read image data.
        if (codewordSize === 0) {
            // Single-entry codebook.
            for (let i = 0; i < 64; ++i) { setColor(i, 0); }
        } else {
            for (let i = 0; i < 64; ++i) {
                setColor(i, this._stream.read(codewordSize));
            }
        }

        // Colorspace conversion and blit.
        for (let j = 0; j < 64; ++j) {
            this._ycbcrToRgb(this._outputBuf, j,
                             this._componentBufY[0][j],
                             this._componentBufCb[j],
                             this._componentBufCr[j]);
        }
        this._blitCallback(8 * this._mcuPosX, 8 * this._mcuPosY,
                           8, 8, this._outputBuf);
        this._advancePosition();
    }

    _parseMcu() {
        const qtLuma   = this.quantTables[0];
        const qtChroma = this.quantTables[1];

        this._parseDataUnit(0, this._tmpBufY[0]);
        this._idct(qtLuma, this._tmpBufY[0], this._componentBufY[0]);
        if (this.subsamplingMode !== 444) {
            this._parseDataUnit(0, this._tmpBufY[1]);
            this._idct(qtLuma, this._tmpBufY[1], this._componentBufY[1]);
            this._parseDataUnit(0, this._tmpBufY[2]);
            this._idct(qtLuma, this._tmpBufY[2], this._componentBufY[2]);
            this._parseDataUnit(0, this._tmpBufY[3]);
            this._idct(qtLuma, this._tmpBufY[3], this._componentBufY[3]);
        }
        this._parseDataUnit(1, this._tmpBufCb);
        this._idct(qtChroma, this._tmpBufCb, this._componentBufCb);
        this._parseDataUnit(2, this._tmpBufCr);
        this._idct(qtChroma, this._tmpBufCr, this._componentBufCr);

        if (this.subsamplingMode !== 444) {
            // 4:2:0 subsampling (x2 in each direction), or what ATEN
            // calls "422" (even though it is not).
            for (let dy = 0; dy < 2; ++dy) {
                for (let dx = 0; dx < 2; ++dx) {
                    const componentBufY = this._componentBufY[dx * 2 + dy];
                    for (let y = 0; y < 8; ++y) {
                        for (let x = 0; x < 8; ++x) {
                            const hy = ~~((8 * dx + y) / 2);
                            const hx = ~~((8 * dy + x) / 2);
                            this._ycbcrToRgb(this._outputBuf, y * 8 + x,
                                             componentBufY[y * 8 + x],
                                             this._componentBufCb[hy * 8 + hx],
                                             this._componentBufCr[hy * 8 + hx]);
                        }
                    }
                    this._blitCallback(
                        16 * this._mcuPosX + 8 * dy,
                        16 * this._mcuPosY + 8 * dx,
                        8, 8, this._outputBuf);
                }
            }
        } else {
            for (let j = 0; j < 64; ++j) {
                this._ycbcrToRgb(this._outputBuf, j,
                                 this._componentBufY[0][j],
                                 this._componentBufCb[j],
                                 this._componentBufCr[j]);
            }
            this._blitCallback(8 * this._mcuPosX, 8 * this._mcuPosY,
                               8, 8, this._outputBuf);
        }
        this._advancePosition();
    }

    _parseDataUnit(componentIdx, buf) {
        const scanComponent = this._scan_components[componentIdx];
        const dc_hufftable = this.huffTables[TABLE_CLASS_DC][scanComponent.huffTableSelectorDC];
        const ac_hufftable = this.huffTables[TABLE_CLASS_AC][scanComponent.huffTableSelectorAC];

        const setValue = (i, val) => { buf[ZIGZAG_ORDER[i]] = val; };

        // First element is DC (stored as delta), followed by 63 AC.
        const dc_delta = this._readEncodedValueDC(dc_hufftable);
        this._scan_prev_dc[componentIdx] += dc_delta;
        buf[0] = this._scan_prev_dc[componentIdx];

        let i = 1;
        while (i < 64) {
            const x = ac_hufftable.readCode(this._stream);

            // Renamed r, s → runlen, size.  See ITU T.81 p89 (Fig F.1).
            // runlen: run of zeroes preceding this sample.
            //   If size == 0 and runlen == 0  → EOB (end-of-block).
            //   If size == 0 and runlen == 15 → ZRL (zero run length).
            // size: bits used to represent the amplitude that follows.
            const runlen = x >>> 4;
            const size = x & 0x0F;

            if (size === 0) {
                if (runlen === 0) {
                    // EOB — fill remainder with zeroes.
                    while (i < 64) { setValue(i, 0); ++i; }
                    break;
                } else if (runlen === 0xF) {
                    // ZRL — emit sixteen zeroes.
                    for (let j = 0; j < 16; ++j) { setValue(i + j, 0); }
                    i += 16;
                    continue;
                }
            }

            // Emit runlen zero entries.
            for (let j = 0; j < runlen; ++j) { setValue(i + j, 0); }
            i += runlen;

            setValue(i, this._readEncodedValueAC(size)); // category = size
            i += 1;
        }

        return buf;
    }

    _readEncodedValueDC(huffTable) {
        const category = huffTable.readCode(this._stream);
        return this._readEncodedValueAC(category);
    }

    _readEncodedValueAC(category) {
        if (category === 0) { return 0; }

        let value;
        const val_sign = this._stream.read(1);

        if (val_sign === 0) {
            // Negative — not two's-complement.
            value = -(1 << category) + 1;
        } else {
            value = (1 << (category - 1));
        }
        if (category > 1) {
            value += this._stream.read(category - 1);
        }
        return value;
    }

    _ycbcrToRgb(outputBuf, outputOffset, y, cb, cr) {
        outputOffset *= 4;
        outputBuf[outputOffset + 0] = clamp(YUVTORGB_Y_TABLE[y] + YUVTORGB_CR_R_TABLE[cr]);
        outputBuf[outputOffset + 1] = clamp(YUVTORGB_Y_TABLE[y] + YUVTORGB_CR_G_TABLE[cr] + YUVTORGB_CB_G_TABLE[cb]);
        outputBuf[outputOffset + 2] = clamp(YUVTORGB_Y_TABLE[y] + YUVTORGB_CB_B_TABLE[cb]);
        outputBuf[outputOffset + 3] = 0xFF;
    }
}
