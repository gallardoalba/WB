"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { Check, Copy, QrCode, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

/**
 * Código de entrega: quien entrega muestra el QR/código y quien recibe lo
 * introduce para confirmar. El servidor solo envía el código a quien entrega.
 *
 * Vale para las dos formas de entrega: en mano se enseña en pantalla y por
 * correo se escribe en un papel dentro del libro.
 */
export function HandoverCode({
  requestId,
  code,
  required,
  onVerified,
}: {
  requestId: string;
  code: string | null;
  required: boolean;
  onVerified: () => void;
}) {
  const { t } = useI18n();
  const [qr, setQr] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!code) return;
    let active = true;
    void import("qrcode")
      .then((module) =>
        module.default.toDataURL(`wanderbibliothek:handover:${requestId}:${code}`, {
          width: 180,
          margin: 1,
          color: { dark: "#2f5741", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [code, requestId]);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles el número sigue a la vista.
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/requests/${requestId}/handover/verify`, {
        method: "POST",
        body: { code: input.trim() },
      });
      setInput("");
      onVerified();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("No se pudo confirmar la entrega."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <div className="handover-code">
        <div className="handover-code-head">
          <QrCode size={16} aria-hidden />
          <strong>{t("Código de entrega")}</strong>
        </div>
        <p>
          {t(
            "Muestra este código al entregar el libro; si lo mandas por correo, apúntalo en un papel y mételo dentro del paquete. La otra persona lo escribe aquí para confirmar que lo ha recibido.",
          )}
        </p>
        <div className="handover-code-card">
          <div className="handover-code-figure">
            <p className="post-label-service">{t("CÓDIGO DE ENTREGA")}</p>
            <output className="handover-code-value" aria-label={t("Código de entrega")}>
              {code}
            </output>
            <button
              type="button"
              className="secondary-button small"
              onClick={() => void copyCode()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
              {copied ? t("Copiado") : t("Copiar el número")}
            </button>
          </div>
          {qr && (
            <Image
              src={qr}
              alt={t("QR con el código de entrega")}
              width={132}
              height={132}
              unoptimized
            />
          )}
        </div>
      </div>
    );
  }

  if (!required) return null;

  return (
    <form className="handover-code" onSubmit={verify}>
      <div className="handover-code-head">
        <ShieldCheck size={16} aria-hidden />
        <strong>{t("Confirma con el código de entrega")}</strong>
      </div>
      <p>
        {t(
          "Pide a la otra persona su código de 6 cifras: te lo puede enseñar en pantalla o venir escrito dentro del libro.",
        )}
      </p>
      <label>
        {t("Código de entrega")}
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={input}
          onChange={(event) => setInput(event.target.value.replace(/\D/g, ""))}
          placeholder="000000"
        />
      </label>
      <button type="submit" className="share-button small" disabled={busy || input.length !== 6}>
        {t("Confirmar entrega")}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
