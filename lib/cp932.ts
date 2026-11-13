/**
 * Zip 内のファイル名を CP932（Windows の日本語 Shift_JIS）で書き込むための変換。
 * Windows の展開ツールの多くは Zip の UTF-8 フラグを無視して CP932 として読むため、
 * Windows 向けの出力ではファイル名をこの形式で格納する。
 *
 * 外部ライブラリを使わず、TextDecoder("shift_jis") の結果から逆引き表を作る。
 */

/** WHATWG の Shift_JIS デコーダと Windows（CP932）で対応する文字が異なるもの。Windows 側の文字から引けるよう補う。 */
const WINDOWS_EXTRA: [string, number][] = [
  ["～", 0x8160], // ～（WHATWG では 〜 U+301C）
  ["∥", 0x8161], // ∥（WHATWG では ‖ U+2016）
  ["－", 0x817c], // －（WHATWG では − U+2212）
  ["￠", 0x8191], // ￠
  ["￡", 0x8192], // ￡
  ["￢", 0x81ca], // ￢
];

let table: Map<string, number> | null = null;

function getTable(): Map<string, number> {
  if (table) return table;
  const map = new Map<string, number>();
  const decoder = new TextDecoder("shift_jis", { fatal: true });

  // 1バイト文字: ASCII と半角カナ
  for (let b = 0x00; b <= 0x7f; b++) map.set(String.fromCharCode(b), b);
  for (let b = 0xa1; b <= 0xdf; b++) {
    map.set(decoder.decode(new Uint8Array([b])), b);
  }

  // 2バイト文字。同じ文字に複数の符号がある場合（NEC / IBM 拡張の重複）は先に見つかった方を使う
  const leads = [...range(0x81, 0x9f), ...range(0xe0, 0xfc)];
  const trails = [...range(0x40, 0x7e), ...range(0x80, 0xfc)];
  for (const lead of leads) {
    for (const trail of trails) {
      let ch: string;
      try {
        ch = decoder.decode(new Uint8Array([lead, trail]));
      } catch {
        continue;
      }
      // 私用領域（外字）は環境依存のため使わない
      if (ch.length !== 1 || (ch >= "" && ch <= "")) continue;
      if (!map.has(ch)) map.set(ch, (lead << 8) | trail);
    }
  }

  for (const [ch, code] of WINDOWS_EXTRA) map.set(ch, code);
  table = map;
  return map;
}

function* range(from: number, to: number): Generator<number> {
  for (let i = from; i <= to; i++) yield i;
}

/** CP932 で表せない文字を replacement に置き換える。ファイル名を Zip に入れる前（重複チェックの前）に使う。 */
export function toCp932Safe(text: string, replacement = "_"): string {
  const map = getTable();
  let out = "";
  for (const ch of text) out += map.has(ch) ? ch : replacement;
  return out;
}

/** 文字列を CP932 のバイト列にする。表せない文字は "_" にする（通常は toCp932Safe 済みの文字列を渡す）。 */
export function encodeCp932(text: string): Uint8Array {
  const map = getTable();
  const bytes: number[] = [];
  for (const ch of text) {
    const code = map.get(ch) ?? 0x5f;
    if (code > 0xff) bytes.push(code >> 8, code & 0xff);
    else bytes.push(code);
  }
  return Uint8Array.from(bytes);
}
