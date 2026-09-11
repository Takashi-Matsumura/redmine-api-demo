/** 対象月（YYYY-MM）から、その月の初日・末日（YYYY-MM-DD）を求める。不正な形式なら null。 */
export function monthToDateRange(
  month: string,
): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  const lastDay = new Date(year, monthNum, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${pad(lastDay)}`,
  };
}

export function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
