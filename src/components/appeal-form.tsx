"use client";

import { useState, type FormEvent } from "react";
import { Scale } from "lucide-react";
import { api } from "@/lib/client-api";
import type { AppealTexts } from "@/lib/appeal-text";
import { useUrlToken } from "@/lib/use-url-token";

export function AppealForm({ token: initialToken, texts }: { token: string; texts: AppealTexts }) {
  const { token, ready } = useUrlToken(initialToken);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");
    try {
      await api("/api/account/appeals", {
        method: "POST",
        body: { token, message: form.get("message") },
      });
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : texts.error);
      setState("idle");
    }
  }

  if (!ready) {
    return (
      <div className="auth-page">
        <p className="form-hint">{texts.sending}</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="empty-state">
        <h1>{texts.invalidTitle}</h1>
        <p>{texts.invalidBody}</p>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="auth-page">
        <span className="dialog-icon">
          <Scale size={20} />
        </span>
        <h1>{texts.title}</h1>
        <p className="action-feedback" role="status">
          {texts.success}
        </p>
      </div>
    );
  }

  return (
    <form className="auth-page listing-form" onSubmit={submit}>
      <span className="dialog-icon">
        <Scale size={20} />
      </span>
      <h1>{texts.title}</h1>
      <p className="form-hint">{texts.intro}</p>
      <label htmlFor="appeal-message">{texts.label}</label>
      <textarea
        id="appeal-message"
        name="message"
        required
        minLength={20}
        maxLength={2000}
        rows={6}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "appeal-error" : "appeal-hint"}
      />
      <p className="form-hint" id="appeal-hint">
        {texts.hint}
      </p>
      {error && (
        <p className="form-error" id="appeal-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" type="submit" disabled={state === "sending"}>
        {state === "sending" ? texts.sending : texts.submit}
      </button>
    </form>
  );
}
