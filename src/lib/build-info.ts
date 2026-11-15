/**
 * Qué código se está sirviendo.
 *
 * La instancia publica en `/api/version` el commit y el digest de la imagen con
 * los que se construyó. No es una prueba criptográfica por sí solo: es el dato
 * que permite contrastar lo que dice el servidor con lo que hay en GitHub y con
 * la imagen firmada de la release. Sin él, esa comparación no se puede ni
 * empezar.
 *
 * El valor se lee del entorno (imagen de Docker, que lo recibe como `ARG`) o de
 * `.build-info.json`, un fichero que escribe `deploy/deploy.sh` en cada release
 * instalada desde el repositorio. Si no hay ninguno de los dos, se devuelve
 * `null`: una instalación sin esa información lo dice, en vez de inventarse un
 * commit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { REPOSITORY } from "./brand";

export type BuildInfo = {
  /** SHA completo del commit, en minúsculas. */
  commit: string | null;
  /** Enlace al commit en el repositorio del proyecto. */
  commitUrl: string | null;
  /** Digest de la imagen (`sha256:…`), si se desplegó con Docker. */
  image: string | null;
  /** Fecha de construcción en ISO 8601, si se conoce. */
  builtAt: string | null;
};

const COMMIT = /^[0-9a-f]{7,40}$/i;
const IMAGE = /^sha256:[0-9a-f]{64}$/i;
/** Nombre del fichero que deja el despliegue por systemd junto al código. */
const BUILD_FILE = ".build-info.json";

type BuildEnv = Record<string, string | undefined>;

function clean(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  return raw && pattern.test(raw) ? raw : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const at = value.trim();
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Lo que dejó el despliegue en disco; `null` si no existe o no es válido. */
function fromFile(cwd: string): Partial<BuildEnv> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(cwd, BUILD_FILE), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Partial<BuildEnv>) : {};
  } catch {
    // Sin fichero (Docker, desarrollo) o con un JSON roto: no es un error de
    // arranque, solo significa que no hay commit que anunciar.
    return {};
  }
}

/**
 * Digest de la imagen, venga suelto (`APP_IMAGE_DIGEST`) o dentro de la
 * referencia con la que se desplegó (`APP_IMAGE=ghcr.io/…@sha256:…`). En el
 * segundo caso no hay que repetirlo en otra variable que se pueda desincronizar.
 */
function imageDigest(env: BuildEnv): string | null {
  const direct = clean(env.APP_IMAGE_DIGEST, IMAGE);
  if (direct) return direct;
  const reference = env.APP_IMAGE?.trim() ?? "";
  const at = reference.lastIndexOf("@");
  return at >= 0 ? clean(reference.slice(at + 1), IMAGE) : null;
}

export function readBuildInfo(env: BuildEnv = process.env, cwd = process.cwd()): BuildInfo {
  const file = fromFile(cwd);
  const commit = clean(env.APP_COMMIT_SHA ?? file.commit, COMMIT);
  return {
    commit,
    commitUrl: commit ? `${REPOSITORY}/commit/${commit}` : null,
    image: imageDigest(env),
    builtAt: isoDate(env.APP_BUILD_TIME ?? file.builtAt),
  };
}

/** Forma corta para el pie de página: siete caracteres, como `git log --oneline`. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
