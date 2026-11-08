/**
 * Zip 内のファイル名・フォルダ名を、Windows / SharePoint で扱える形に整える。
 * Redmine の件名や添付ファイル名は任意文字列のため、パス区切りによるディレクトリ脱出も含めてここで無害化する。
 */

// Windows / SharePoint で使えない文字と制御文字
const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * 1要素（フォルダ名・ファイル名）として安全な文字列にする。
 * keepExtension（既定 true）なら拡張子を保持し、本体部分を maxLength 文字で切り詰める。
 */
export function sanitizeFileName(
  name: string,
  opts?: { maxLength?: number; fallback?: string; keepExtension?: boolean },
): string {
  const maxLength = opts?.maxLength ?? 100;
  const keepExtension = opts?.keepExtension ?? true;
  const fallback = opts?.fallback ?? "file";

  let cleaned = name.normalize("NFC").replace(INVALID_CHARS, "_").replace(/\s+/g, " ").trim();
  // 先頭・末尾のドットやスペースは Windows で問題になる
  cleaned = cleaned.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");

  const dot = cleaned.lastIndexOf(".");
  const hasExt = keepExtension && dot > 0 && cleaned.length - dot <= 11;
  let base = hasExt ? cleaned.slice(0, dot) : cleaned;
  const ext = hasExt ? cleaned.slice(dot) : "";

  base = Array.from(base).slice(0, maxLength).join("").replace(/[.\s]+$/, "");
  if (!base) base = fallback;
  if (RESERVED_NAMES.test(base)) base = `_${base}`;
  if (base.startsWith("~$")) base = `_${base.slice(1)}`;

  return `${base}${ext}`;
}

/**
 * 同じフォルダ内で名前が重複しないよう、重複時は「名前 (2).ext」のように連番を付ける。
 * Windows は大文字小文字を区別しないため、比較は小文字で行う。
 */
export class UniqueNamer {
  private used = new Set<string>();

  take(name: string): string {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";

    let candidate = name;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) {
      candidate = `${base} (${n})${ext}`;
    }
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}
