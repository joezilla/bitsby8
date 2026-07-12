/**
 * VDM-1 character font (Story 5.9) — the exact Signetics 2513 (CM2140) character
 * generator ROM the VDM-1 / Apple-1 / SOL used. 64 uppercase-ASCII glyphs
 * (0x20–0x5F), each 5 wide × 7 tall; the low 5 bits of each row are columns,
 * MSB = leftmost pixel. Lowercase folds to uppercase (the real board is
 * uppercase-only).
 *
 * Transcribed from the 2513u.bin ROM dump (bbenchoff/2513CharGenAdapter): 64
 * cells of 8 rows, top row blank, ROM char order '@'..'_' then ' '..'?'. Masked
 * to the low 5 bits (the dump drives the EPROM's unused D5–D7 high on full-width
 * rows). This is the authentic set — note the slashed zero, the notched M/W, and
 * the distinctive @ — replacing the earlier hand-authored approximation.
 */

// prettier-ignore
const G: Record<number, number[]> = {
  0x20: [0,0,0,0,0,0,0],              // space
  0x21: [4,4,4,4,4,0,4],              // !
  0x22: [10,10,10,0,0,0,0],           // "
  0x23: [10,10,31,10,31,10,10],       // #
  0x24: [4,15,20,14,5,30,4],          // $
  0x25: [24,25,2,4,8,19,3],           // %
  0x26: [8,20,20,8,21,18,13],         // &
  0x27: [4,4,4,0,0,0,0],              // '
  0x28: [4,8,16,16,16,8,4],           // (
  0x29: [4,2,1,1,1,2,4],              // )
  0x2a: [4,21,14,4,14,21,4],          // *
  0x2b: [0,4,4,31,4,4,0],             // +
  0x2c: [0,0,0,0,4,4,8],              // ,
  0x2d: [0,0,0,31,0,0,0],             // -
  0x2e: [0,0,0,0,0,0,4],              // .
  0x2f: [0,1,2,4,8,16,0],             // /
  0x30: [14,17,19,21,25,17,14],       // 0
  0x31: [4,12,4,4,4,4,14],            // 1
  0x32: [14,17,1,6,8,16,31],          // 2
  0x33: [31,1,2,6,1,17,14],           // 3
  0x34: [2,6,10,18,31,2,2],           // 4
  0x35: [31,16,30,1,1,17,14],         // 5
  0x36: [7,8,16,30,17,17,14],         // 6
  0x37: [31,1,2,4,8,8,8],             // 7
  0x38: [14,17,17,14,17,17,14],       // 8
  0x39: [14,17,17,15,1,2,28],         // 9
  0x3a: [0,0,4,0,4,0,0],              // :
  0x3b: [0,0,4,0,4,4,8],              // ;
  0x3c: [2,4,8,16,8,4,2],             // <
  0x3d: [0,0,31,0,31,0,0],            // =
  0x3e: [8,4,2,1,2,4,8],              // >
  0x3f: [14,17,2,4,4,0,4],            // ?
  0x40: [14,17,21,23,22,16,15],       // @
  0x41: [4,10,17,17,31,17,17],        // A
  0x42: [30,17,17,30,17,17,30],       // B
  0x43: [14,17,16,16,16,17,14],       // C
  0x44: [30,17,17,17,17,17,30],       // D
  0x45: [31,16,16,30,16,16,31],       // E
  0x46: [31,16,16,30,16,16,16],       // F
  0x47: [15,16,16,16,19,17,15],       // G
  0x48: [17,17,17,31,17,17,17],       // H
  0x49: [14,4,4,4,4,4,14],            // I
  0x4a: [1,1,1,1,1,17,14],            // J
  0x4b: [17,18,20,24,20,18,17],       // K
  0x4c: [16,16,16,16,16,16,31],       // L
  0x4d: [17,27,21,21,17,17,17],       // M
  0x4e: [17,17,25,21,19,17,17],       // N
  0x4f: [14,17,17,17,17,17,14],       // O
  0x50: [30,17,17,30,16,16,16],       // P
  0x51: [14,17,17,17,21,18,13],       // Q
  0x52: [30,17,17,30,20,18,17],       // R
  0x53: [14,17,16,14,1,17,14],        // S
  0x54: [31,4,4,4,4,4,4],             // T
  0x55: [17,17,17,17,17,17,14],       // U
  0x56: [17,17,17,17,17,10,4],        // V
  0x57: [17,17,17,21,21,27,17],       // W
  0x58: [17,17,10,4,10,17,17],        // X
  0x59: [17,17,10,4,4,4,4],           // Y
  0x5a: [31,1,2,4,8,16,31],           // Z
  0x5b: [31,24,24,24,24,24,31],       // [
  0x5c: [0,16,8,4,2,1,0],             // \
  0x5d: [31,3,3,3,3,3,31],            // ]
  0x5e: [0,0,4,10,17,0,0],            // ^
  0x5f: [0,0,0,0,0,0,31],             // _
};

const BLANK = [0, 0, 0, 0, 0, 0, 0];

/** The 7-row glyph for a character byte (bit 7 is the attribute, not the code). */
export function vdmGlyph(byte: number): number[] {
  let c = byte & 0x7f;
  if (c >= 0x61 && c <= 0x7a) c -= 0x20; // fold lowercase → uppercase (VDM is uppercase-only)
  return G[c] ?? BLANK;
}

export const VDM_GLYPH_W = 5;
export const VDM_GLYPH_H = 7;
