"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { normalizeIsbn } from "@/lib/text";
import { useI18n } from "./i18n-provider";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;
}

/**
 * Escáner de ISBN con la cámara del dispositivo. Usa `BarcodeDetector` cuando
 * el navegador lo ofrece; si no, no se muestra y el campo sigue siendo manual.
 */
export function IsbnScanner({ onDetected }: { onDetected: (isbn: string) => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => {
    return stop;
  }, [stop]);

  async function start() {
    const Detector = detectorConstructor();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError(t("Este navegador no puede escanear códigos. Puedes escribir el ISBN a mano."));
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      detectorRef.current = new Detector({ formats: ["ean_13", "ean_8", "upc_a"] });
      // El vídeo se monta en el mismo render que `active`; esperamos al frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play();

      const scan = async () => {
        if (!streamRef.current || !detectorRef.current || !videoRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          for (const code of codes) {
            const isbn = normalizeIsbn(code.rawValue);
            if (isbn && (isbn.length === 10 || isbn.length === 13)) {
              onDetected(isbn);
              stop();
              return;
            }
          }
        } catch {
          // Un frame ilegible no debe detener el escaneo.
        }
        timerRef.current = window.setTimeout(scan, 350);
      };
      void scan();
    } catch (caught) {
      stop();
      const reason = caught instanceof DOMException ? caught.name : "";
      setError(
        reason === "NotAllowedError"
          ? t("No hay permiso para usar la cámara. Puedes escribir el ISBN a mano.")
          : reason === "NotFoundError"
            ? t("No se encontró una cámara disponible. Puedes escribir el ISBN a mano.")
            : t("No se pudo abrir la cámara. Puedes escribir el ISBN a mano."),
      );
    }
  }

  return (
    <div className="isbn-scanner">
      {active ? (
        <div className="isbn-scanner-live">
          <video ref={videoRef} muted playsInline aria-label={t("Vista de la cámara para escanear el ISBN")} />
          <button type="button" className="secondary-button small" onClick={stop}>
            <X size={15} aria-hidden /> {t("Cancelar")}
          </button>
        </div>
      ) : (
        <button type="button" className="secondary-button small isbn-scan-button" onClick={start}>
          <Camera size={15} aria-hidden /> {t("Escanear ISBN")}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
