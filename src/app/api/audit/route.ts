import { NextRequest, NextResponse } from "next/server";
import { executeDiffAudit } from "@/lib/auditor";
import {
  guardErrorResponse,
  HttpGuardError,
  readBoundedJsonObject,
  requireApiAccess,
} from "@/lib/http-guard";
import { parsePublicLLMOptions, PublicLLMInputError } from "@/lib/llm";

const MAX_AUDIT_REQUEST_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    requireApiAccess(request);
    const body = await readBoundedJsonObject(request, MAX_AUDIT_REQUEST_BYTES);
    const diff = typeof body.diff === "string" ? body.diff.trim() : "";
    const taskContext = typeof body.context === "string" ? body.context.trim() : "";
    const publicOptions = parsePublicLLMOptions({
      ...body,
      model: body.model ?? body.auditorModel,
    });

    if (!diff) {
      return NextResponse.json(
        { error: "Please provide a Git Diff or code changes to audit." },
        { status: 400 }
      );
    }

    const report = await executeDiffAudit(diff, {
      context: taskContext,
      ...publicOptions,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("Audit API error:", error);
    if (error instanceof HttpGuardError) {
      return guardErrorResponse(error);
    }
    if (error instanceof PublicLLMInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to perform quality and security audit on diff.",
      },
      { status: 500 }
    );
  }
}
