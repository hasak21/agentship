// AgentShip research API route.
// The browser sends a question here; we ask Gemini and send the answer back.
// This file runs ONLY on the server, so the API key is never exposed to users.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

// A system-style instruction that shapes how the agent answers.
const SYSTEM_PROMPT = `You are AgentShip, a helpful research assistant.
Answer the user's question clearly and accurately.
Use short paragraphs and bullet points where helpful.
If you are unsure or the question needs up-to-date information you may not have, say so honestly.`;

export async function POST(request: Request) {
  try {
    const { question } = await request.json();

    // Basic validation so we fail with a clear message instead of a crash.
    if (!question || typeof question !== "string" || question.trim() === "") {
      return Response.json(
        { error: "Please enter a question." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Server is missing GEMINI_API_KEY. Check .env.local." },
        { status: 500 }
      );
    }

    // Call the Gemini API.
    const geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            parts: [{ text: question }],
          },
        ],
      }),
    });

    if (!geminiResponse.ok) {
      const details = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, details);
      return Response.json(
        { error: "The AI provider returned an error. Please try again." },
        { status: 502 }
      );
    }

    const data = await geminiResponse.json();

    // Pull the answer text out of Gemini's response shape.
    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text)
        .filter(Boolean)
        .join("\n") ?? "";

    if (!answer) {
      return Response.json(
        { error: "The AI returned an empty answer. Please try again." },
        { status: 502 }
      );
    }

    return Response.json({ answer });
  } catch (err) {
    console.error("Research route error:", err);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
