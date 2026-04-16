/*
 * noVNC: HTML5 VNC client — ATEN AST2100 inverse DCT (AAN-style).
 *
 * Originally (c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>,
 * clean-room reverse-engineered for kelleyk/noVNC#bmc-support and
 * modelled on libjpeg's jidctfst.c ("fast, not-so-accurate integer
 * IDCT") with the same 16/16 fixed-point representation ATEN uses.
 *
 * Ported to ES modules 2026 — algorithm unchanged.
 */

// CONST_BITS == 8 is assumed everywhere below.
const CONST_BITS = 8;
const PASS1_BITS = 0;

// N.B.(kelleyk): Not a libjpeg parameter — ATEN downshifts all the way
// back to "normal ints" at the end of pass 1.
const END_PASS1_DESCALE_BITS = CONST_BITS;

// Fixed-point approximations of cos/sin constants.
const FIX_1_082392200 = 277;
const FIX_1_414213562 = 362;
const FIX_1_847759065 = 473;
const FIX_2_613125930 = 669;

function descale(x, n) {
    return x >> n;
}

// If not accurate-rounding mode...
const idescale = descale;

function fixed_mul(a, b) {
    return descale(a * b, CONST_BITS);
}

function fixed_dequant(scaled_quant_table, buf, i) {
    // The data in `buf` is unscaled; `scaled_quant_table` has been
    // scaled by 1<<16.
    return fixed_mul(scaled_quant_table[i], buf[i]);
}

// clamp() + MAXJSAMPLE/2 offset.  Per libjpeg's jdmaster.c, the offset
// is baked into the range-limit table used by ATEN.
function range_limit(x) {
    x += 128;
    return Math.max(0, Math.min(255, x));
}

export default class AST2100IDCT {
    //
    // Uses the 16/16 integer representation that ATEN and libjpeg's
    // jidctfst.c use.  For performance, also incorporates the
    // dequantization step, which is why `scaled_quant_table` is an
    // argument.  (That table does not actually contain "just" a scaled
    // quant table; some constants have been pre-multiplied into it.
    // See the function that loads quant tables for details.)
    //
    static idct_fixed_aan(scaled_quant_table, buf, dstBuf) {
        // ATEN rounds off early, at a cost to precision: the int32
        // values in `workspace` are not scaled at all.
        const workspace = new Int32Array(64);

        for (let x = 0; x < 8; ++x) {
            AST2100IDCT._aan_idct_col(scaled_quant_table, buf, workspace, x);
        }
        for (let y = 0; y < 8; ++y) {
            AST2100IDCT._aan_idct_row(scaled_quant_table, dstBuf, workspace, y);
        }
        return dstBuf;
    }

    // Columns — "Pass 1".
    static _aan_idct_col(scaled_quant_table, buf, workspace, x) {
        const dequant = (idx) => fixed_dequant(scaled_quant_table, buf, idx);
        const mul = fixed_mul;

        let all_ac_zero = true;
        for (let y = 1; y < 8; ++y) {
            if (buf[8 * y + x] !== 0) { all_ac_zero = false; break; }
        }
        if (all_ac_zero) {
            const dcval = idescale(dequant(8 * 0 + x), END_PASS1_DESCALE_BITS);
            for (let y = 0; y < 8; ++y) { workspace[8 * y + x] = dcval; }
            return;
        }

        // Even part.
        let tmp0 = dequant(8 * 0 + x);
        let tmp1 = dequant(8 * 2 + x);
        const tmp2_in = dequant(8 * 4 + x);
        const tmp3_in = dequant(8 * 6 + x);

        let tmp10 = tmp0 + tmp2_in;  // Phase 3
        let tmp11 = tmp0 - tmp2_in;
        let tmp13 = tmp1 + tmp3_in;  // Phases 5-3
        let tmp12 = mul((tmp1 - tmp3_in), FIX_1_414213562) - tmp13;  // 2 * c4

        tmp0 = tmp10 + tmp13;
        let tmp3 = tmp10 - tmp13;
        tmp1 = tmp11 + tmp12;
        let tmp2 = tmp11 - tmp12;

        // Odd part.
        const tmp4_in = dequant(8 * 1 + x);
        const tmp5_in = dequant(8 * 3 + x);
        const tmp6_in = dequant(8 * 5 + x);
        let tmp7 = dequant(8 * 7 + x);

        const z13 = tmp6_in + tmp5_in;  // Phase 6
        const z10 = tmp6_in - tmp5_in;
        const z11 = tmp4_in + tmp7;
        const z12 = tmp4_in - tmp7;

        tmp7 = z11 + z13;  // Phase 5
        tmp11 = mul((z11 - z13), FIX_1_414213562);  // 2 * c4

        const z5 = mul((z10 + z12), FIX_1_847759065); // 2 * c2
        tmp10 = mul(FIX_1_082392200, z12) - z5;       // 2 * (c2-c6)
        tmp12 = mul(-FIX_2_613125930, z10) + z5;

        const tmp6 = tmp12 - tmp7;
        const tmp5 = tmp11 - tmp6;
        const tmp4 = tmp10 + tmp5;

        workspace[x + 8 * 0] = idescale(tmp0 + tmp7, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 7] = idescale(tmp0 - tmp7, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 1] = idescale(tmp1 + tmp6, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 6] = idescale(tmp1 - tmp6, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 2] = idescale(tmp2 + tmp5, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 5] = idescale(tmp2 - tmp5, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 4] = idescale(tmp3 + tmp4, END_PASS1_DESCALE_BITS);
        workspace[x + 8 * 3] = idescale(tmp3 - tmp4, END_PASS1_DESCALE_BITS);
    }

    // Rows — "Pass 2".
    static _aan_idct_row(scaled_quant_table, buf, workspace, y) {
        const wsptr = (x) => workspace[8 * y + x];
        const mul = fixed_mul;

        // Even part.
        const tmp10 = wsptr(0) + wsptr(4);
        const tmp11 = wsptr(0) - wsptr(4);
        const tmp13 = wsptr(2) + wsptr(6);
        const tmp12 = mul((wsptr(2) - wsptr(6)), FIX_1_414213562) - tmp13;

        const tmp0 = tmp10 + tmp13;
        const tmp3 = tmp10 - tmp13;
        const tmp1 = tmp11 + tmp12;
        const tmp2 = tmp11 - tmp12;

        // Odd part.
        const z13 = wsptr(5) + wsptr(3);
        const z10 = wsptr(5) - wsptr(3);
        const z11 = wsptr(1) + wsptr(7);
        const z12 = wsptr(1) - wsptr(7);

        let tmp7 = z11 + z13;
        const tmp11b = mul((z11 - z13), FIX_1_414213562);

        const z5 = mul((z10 + z12), FIX_1_847759065); // 2 * c2
        const tmp10b = mul(FIX_1_082392200, z12) - z5; // 2 * (c2-c6)
        const tmp12b = mul(-FIX_2_613125930, z10) + z5;

        const tmp6 = tmp12b - tmp7;
        const tmp5 = tmp11b - tmp6;
        const tmp4 = tmp10b + tmp5;

        const set_out = (x, val) => {
            // Shift right by PASS1_BITS bits to convert back to a
            // normal int, and then by another 3 to divide by 8.
            val = idescale(val, PASS1_BITS + 3);
            val = range_limit(val);  // also applies +128 offset
            buf[y * 8 + x] = val;
        };

        set_out(0, tmp0 + tmp7);
        set_out(7, tmp0 - tmp7);
        set_out(1, tmp1 + tmp6);
        // FIXME(port-2026): this line reads `tmp0 - tmp6` in the
        // original kelleyk fork, but the parallel column-pass code
        // (_aan_idct_col) uses `tmp1 - tmp6` for position 6.  Almost
        // certainly a typo in the upstream fork.  Preserved verbatim
        // here to match the fork's observed output; fix pending an
        // A/B comparison against captured ATEN frames.
        set_out(6, tmp0 - tmp6);
        set_out(2, tmp2 + tmp5);
        set_out(5, tmp2 - tmp5);
        set_out(4, tmp3 + tmp4);
        set_out(3, tmp3 - tmp4);
    }
}
