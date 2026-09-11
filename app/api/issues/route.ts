import type { NextRequest } from "next/server";
import { getIssues } from "@/lib/redmine";
import { redmineErrorResponse } from "@/lib/redmine-response";

export async function GET(req: NextRequest) {
  const redmineUrl = req.headers.get("x-redmine-url")?.trim();
  const apiKey = req.headers.get("x-redmine-api-key")?.trim();

  if (!redmineUrl || !apiKey) {
    return Response.json(
      { error: "Redmine URLとAPIキーを入力してください" },
      { status: 400 },
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  const projectId = searchParams.get("project_id") ?? undefined;
  const statusId = searchParams.get("status_id") ?? undefined;
  const sort = searchParams.get("sort") ?? undefined;
  const createdOnFromParam = searchParams.get("created_on_from");
  const createdOnToParam = searchParams.get("created_on_to");
  const closedOnly = searchParams.get("closed_only") === "1";

  const limit = limitParam && /^\d+$/.test(limitParam) ? Number(limitParam) : undefined;
  const offset = offsetParam && /^\d+$/.test(offsetParam) ? Number(offsetParam) : undefined;

  const isValidDate = (v: string | null): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const createdOnFrom = isValidDate(createdOnFromParam) ? createdOnFromParam : undefined;
  const createdOnTo = isValidDate(createdOnToParam) ? createdOnToParam : undefined;

  try {
    const result = await getIssues(
      { redmineUrl, apiKey },
      { limit, offset, projectId, statusId, sort, createdOnFrom, createdOnTo, closedOnly },
    );
    return Response.json(result);
  } catch (err) {
    return redmineErrorResponse(err, "Redmine issue list fetch failed");
  }
}
