"use client";

import { KeyboardEvent, useEffect, useState } from "react";

import { useAIAssistant } from "../lib/ai-assistant-context";

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const SUGGESTED_PROMPTS = [
  "How many action plans are overdue right now?",
  "What is the current status breakdown?",
  "What was the most recent activity?",
  "Which items are pending validation?",
  "Give me a summary of where things stand",
];

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseError(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function getCurrentContext() {
  if (typeof window === "undefined") {
    return {};
  }

  const actionPlanMatch = window.location.pathname.match(/\/action-plans\/([^/]+)/);
  return {
    page: document.title || window.location.pathname,
    action_plan_id: actionPlanMatch?.[1],
  };
}

export default function AIAssistant() {
  const { isOpen, closeAssistant } = useAIAssistant();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") closeAssistant();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeAssistant, isOpen]);

  async function sendMessage(message = draft) {
    const trimmed = message.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const userMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          context: getCurrentContext(),
        }),
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseError(body, "Unable to reach AI assistant."));
      }

      const reply =
        body && typeof body === "object" && "reply" in body
          ? String(body.reply)
          : "I could not generate a response.";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply,
        },
      ]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to reach AI assistant.");
    } finally {
      setIsLoading(false);
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <aside className={`ai-assistant-panel${isOpen ? " ai-assistant-panel--open" : ""}`}>
      <header className="ai-assistant-panel__header">
        <span className="ai-assistant-panel__shield">◈</span>
        <div>
          <strong>AI Assistant</strong>
          <em><i /> Online</em>
        </div>
        <button aria-label="Close AI Assistant" onClick={closeAssistant} type="button">
          ×
        </button>
      </header>

      <div className="ai-assistant-panel__body">
        {messages.length === 0 ? (
          <section className="ai-assistant-suggestions">
            <p>Try asking:</p>
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button key={prompt} onClick={() => sendMessage(prompt)} type="button">
                {prompt}
              </button>
            ))}
          </section>
        ) : null}

        {messages.map((message) => (
          <article
            className={`ai-assistant-message ai-assistant-message--${message.role}`}
            key={message.id}
          >
            {message.content}
          </article>
        ))}

        {isLoading ? (
          <div className="ai-assistant-typing" aria-label="AI Assistant is typing">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {error ? <div className="ai-assistant-error">{error}</div> : null}
      </div>

      <footer className="ai-assistant-panel__input">
        <input
          placeholder="Ask about audits or action plans..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <button disabled={isLoading || !draft.trim()} onClick={() => sendMessage()} type="button">
          Send
        </button>
      </footer>
    </aside>
  );
}
