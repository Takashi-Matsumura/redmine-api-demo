import type { NextRequest } from "next/server";
import { getAllIssues, getIssuesDetailed } from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";
import { monthToDateRange } from "@/lib/month";
import { issuesToMarkdown } from "@/lib/markdown";

// 数百件規模の詳細取得（N+1）でも既定のタイムアウトに触れないようにする。
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const redmineUrl = req.headers.get("x-redmine-url")?.trim();
  const apiKey = req.headers.get("x-redmine-api-key")?.trim();

  if (!redmineUrl || !apiKey) {
    return Response.json(
      { error: "Redmine URLとAPIキーを入力してください" },
      { status: 400 },
    );
  }

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return Response.json(
      { error: "対象月（YYYY-MM形式）を指定してください" },
      { status: 400 },
    );
  }

  const range = monthToDateRange(month);
  if (!range) {
    return Response.json(
      { error: "対象月（YYYY-MM形式）を指定してください" },
      { status: 400 },
    );
  }

  const closedOnly = req.nextUrl.searchParams.get("closed_only") === "1";
  const conn = { redmineUrl, apiKey };

  try {
    const { issues: summaries, totalCount, truncated } = await getAllIssues(
      conn,
      { createdOnFrom: range.from, createdOnTo: range.to, closedOnly },
    );

    const { issues, failures } = await getIssuesDetailed(
      conn,
      summaries.map((s) => s.id),
    );

    let excludedPrivateNotes = 0;
    for (const issue of issues) {
      for (const journal of issue.journals ?? []) {
        if (journal.notes && journal.private_notes) excludedPrivateNotes += 1;
      }
    }

    const markdown = issuesToMarkdown(issues, {
      redmineBaseUrl: redmineUrl,
      month,
      from: range.from,
      to: range.to,
      closedOnly,
      excludedPrivateNotes,
      failures,
      truncated: truncated
        ? { totalCount, fetchedCount: summaries.length }
        : undefined,
      exportedAt: new Date().toISOString(),
    });

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="redmine-${month}.md"`,
      },
    });
  } catch (err) {
    return redmineErrorResponse(err, "Redmine export failed");
  }
}
