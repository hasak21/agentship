import { NextRequest, NextResponse } from "next/server";
import { executeDiffAudit } from "@/lib/auditor";
import { LLMProvider } from "@/lib/llm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const diff = (body.diff ?? "").trim();
    const taskContext = (body.context ?? "").trim();
    const model = body.model || body.auditorModel;
    const provider = body.provider as LLMProvider | undefined;
    const apiKey = body.apiKey;
    const baseUrl = body.baseUrl;

    if (!diff) {
      return NextResponse.json(
        { error: "Please provide a Git Diff or code changes to audit." },
        { status: 400 }
      );
    }

    const report = await executeDiffAudit(diff, {
      context: taskContext,
      model,
      provider,
      apiKey,
      baseUrl,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("Audit API error:", error);
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
