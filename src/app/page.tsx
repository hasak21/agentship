"use client";

// "use client" means this component runs in the browser, so it can use
// state (useState) and respond to clicks/typing.

import { useState } from "react";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setError("");
    setAnswer("");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setAnswer(data.answer);
      }
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16 sm:py-24">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            🚀 AgentShip
          </h1>
          <p className="mt-3 text-lg text-neutral-500 dark:text-neutral-400">
            Ask a question. Your research agent answers.
          </p>
        </div>

        {/* Question form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What are the pros and cons of electric cars?"
            rows={3}
            className="w-full resize-none rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:focus:border-neutral-300 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium px-5 py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? "Researching…" : "Research"}
          </button>
        </form>

        {/* Error message */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-4 py-3 text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Answer */}
        {answer && (
          <div className="mt-8 rounded-xl border border-neutral-200 dark:border-neutral-800 px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
              Answer
            </h2>
            <div className="whitespace-pre-wrap leading-relaxed">{answer}</div>
          </div>
        )}

        {/* Footer hint */}
        <p className="mt-12 text-center text-sm text-neutral-400">
          Powered by Gemini · Web search coming soon
        </p>
      </div>
    </main>
  );
}
