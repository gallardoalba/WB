"use client";

import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { api } from "@/lib/client-api";
import type { AppealTexts } from "@/lib/appeal-text";

/** Pide otro enlace cuando el del correo se ha perdido o ha caducado. */
export function AppealLinkForm({ texts }: { texts: AppealTexts }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");
    try {
      await api("/api/account/appeal-link", {
        method: "POST",
        body: { email: form.get("email") },
      });
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : texts.linkError);
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p className="action-feedback" role="status">
        {texts.linkSuccess}
      </p>
    );
  }

  return (
    <form className="listing-form" onSubmit={submit}>
      <label htmlFor="appeal-link-email">{texts.linkLabel}</label>
      <input
        id="appeal-link-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        aria-invalid={error ? true : undefined}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="secondary-button small" type="submit" disabled={state === "sending"}>
        <Mail size={14} /> {state === "sending" ? texts.linkSending : texts.linkSubmit}
      </button>
    </form>
  );
}
