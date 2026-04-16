/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

export const encodings = {
    encodingRaw: 0,
    encodingCopyRect: 1,
    encodingRRE: 2,
    encodingHextile: 5,
    encodingZlib: 6,
    encodingTight: 7,
    encodingZRLE: 16,
    encodingTightPNG: -260,
    encodingJPEG: 21,
    encodingH264: 50,

    // ATEN iKVM proprietary encodings (Supermicro / ASRock / other BMCs
    // using ATEN AST2100-family SoCs).  Not part of the RFB standard; the
    // fork-of-noVNC lineage documents them:
    //   https://github.com/kelleyk/noVNC  branch bmc-support
    encodingATENAST2100: 0x57,
    encodingATENASTJPEG: 0x58,
    encodingATENHermon:  0x59,
    encodingATENYarkon:  0x60,
    encodingATENPilot3:  0x61,

    pseudoEncodingQualityLevel9: -23,
    pseudoEncodingQualityLevel0: -32,
    pseudoEncodingDesktopSize: -223,
    pseudoEncodingLastRect: -224,
    pseudoEncodingCursor: -239,
    pseudoEncodingQEMUExtendedKeyEvent: -258,
    pseudoEncodingQEMULedEvent: -261,
    pseudoEncodingDesktopName: -307,
    pseudoEncodingExtendedDesktopSize: -308,
    pseudoEncodingXvp: -309,
    pseudoEncodingFence: -312,
    pseudoEncodingContinuousUpdates: -313,
    pseudoEncodingExtendedMouseButtons: -316,
    pseudoEncodingCompressLevel9: -247,
    pseudoEncodingCompressLevel0: -256,
    pseudoEncodingVMwareCursor: 0x574d5664,
    pseudoEncodingExtendedClipboard: 0xc0a1e5ce
};

export function encodingName(num) {
    switch (num) {
        case encodings.encodingRaw:      return "Raw";
        case encodings.encodingCopyRect: return "CopyRect";
        case encodings.encodingRRE:      return "RRE";
        case encodings.encodingHextile:  return "Hextile";
        case encodings.encodingZlib:     return "Zlib";
        case encodings.encodingTight:    return "Tight";
        case encodings.encodingZRLE:     return "ZRLE";
        case encodings.encodingTightPNG: return "TightPNG";
        case encodings.encodingJPEG:     return "JPEG";
        case encodings.encodingH264:     return "H.264";
        case encodings.encodingATENAST2100: return "ATEN_AST2100";
        case encodings.encodingATENASTJPEG: return "ATEN_ASTJPEG";
        case encodings.encodingATENHermon:  return "ATEN_Hermon";
        case encodings.encodingATENYarkon:  return "ATEN_Yarkon";
        case encodings.encodingATENPilot3:  return "ATEN_Pilot3";
        default:                         return "[unknown encoding " + num + "]";
    }
}
