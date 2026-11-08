import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Mac OS X の Aqua 風（ジェル状で上半分に光沢のある、角の丸い）ボタン。
 * 見た目は app/globals.css の .aqua-btn で定義している。
 */
export function AquaButton({
  variant = "secondary",
  icon,
  loading = false,
  loadingLabel,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: 青いジェル（主な操作） / secondary: 白いジェル */
  variant?: "primary" | "secondary";
  icon: ReactNode;
  loading?: boolean;
  /** 処理中に表示するラベル。省略時は通常のラベルのまま。 */
  loadingLabel?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`aqua-btn aqua-btn--${variant} ${className ?? ""}`}
    >
      <span className="aqua-btn__icon" aria-hidden="true">
        {loading ? <SpinnerIcon /> : icon}
      </span>
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SpinnerIcon() {
  return (
    <svg {...iconProps} className="animate-spin">
      <path d="M8 1.75a6.25 6.25 0 1 0 6.25 6.25" />
    </svg>
  );
}

/** 一覧の再取得（矢印付きのリスト）。 */
export function ListIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 4h7M2.5 8h5M2.5 12h4" />
      <path d="M13.5 8.5a3 3 0 1 1-1-2.25" />
      <path d="M12.75 4.75v1.75H11" />
    </svg>
  );
}

/** Word 文書（docx）。 */
export function DocumentIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 1.75h5l3.25 3.25v9.25H4z" />
      <path d="M9 1.75V5h3.25" />
      <path d="M5.75 8l.75 3.5L7.5 9l1 2.5.75-3.5" />
    </svg>
  );
}

/** Markdown（M と下向き矢印）。 */
export function MarkdownIcon() {
  return (
    <svg {...iconProps}>
      <rect x="1.25" y="3.5" width="13.5" height="9" rx="1.5" />
      <path d="M3.75 10.5v-5l2 2.5 2-2.5v5" />
      <path d="M11.5 5.5v5M10 9l1.5 1.5L13 9" />
    </svg>
  );
}
