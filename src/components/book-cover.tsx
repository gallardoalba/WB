"use client";

import Image from "next/image";
import { useState } from "react";
import { toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type BookCoverProps = {
  id: string;
  title: string;
  coverUrl: string | null;
  sizes?: string;
};

export function BookCover({ id, title, coverUrl, sizes = "(max-width: 700px) 44vw, 220px" }: BookCoverProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  if (!coverUrl || failed) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    const initials = `${words[0]?.charAt(0) ?? "L"}${words[1]?.charAt(0) ?? ""}`.toUpperCase();
    return (
      <div className={`cover-fallback tone-${toneForId(id)}`} aria-hidden="true">
        <span>{initials}</span>
        <small>{title}</small>
      </div>
    );
  }

  return (
    <Image
      src={coverUrl}
      alt={t("Portada de {title}", { title })}
      fill
      sizes={sizes}
      unoptimized
      className="cover-image"
      onError={() => setFailed(true)}
      onLoad={(event) => {
        // OpenLibrary responde 200 con una imagen 1×1 cuando no tiene portada.
        const image = event.currentTarget;
        if (image.naturalWidth < 20 || image.naturalHeight < 30) setFailed(true);
      }}
    />
  );
}
