/**
 * Preparación de una portada antes de subirla.
 *
 * `coverSize` ya tiene sus pruebas sin DOM; aquí se cubre lo que ocurre
 * alrededor: no recomprimir lo que ya vale, reducir una foto de móvil, bajar
 * calidad antes que tamaño y fallar con un mensaje claro cuando el navegador no
 * puede decodificar el archivo. `canvas`, `Image` y `createImageBitmap` se
 * sustituyen por dobles mínimos para poder ejecutarlo en Node.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MAX_COVER_BYTES, prepareCover } from "../src/lib/cover-image.ts";

type Dibujo = { width: number; height: number; type: string; quality: number };
type OpcionesBitmap = ImageBitmapOptions | undefined;

type Estado = {
  dibujos: Dibujo[];
  bitmapOpciones: OpcionesBitmap[];
  bitmaps: number;
  cierres: number;
  revocadas: number;
  objectUrls: number;
};

type Config = {
  /** Tamaño que devuelve el decodificador. `null` simula un navegador sin `createImageBitmap`. */
  bitmap: { width: number; height: number } | null;
  /** Bytes de cada `toBlob`, por intento. Lo que falte se queda en 1 000. */
  bytes?: number[];
  /** `createImageBitmap` falla la primera vez (opciones de orientación). */
  bitmapFallaPrimera?: boolean;
  contexto?: "normal" | "sin-contexto";
  decodeFalla?: boolean;
  /** Tamaño de la imagen del camino alternativo (`<img>`). */
  imagen?: { width: number; height: number };
};

const scope = globalThis as unknown as {
  createImageBitmap?: typeof createImageBitmap;
  document?: Document;
  Image?: typeof Image;
};

const originales = {
  createImageBitmap: scope.createImageBitmap,
  document: scope.document,
  Image: scope.Image,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

function restaurar() {
  if (originales.createImageBitmap) scope.createImageBitmap = originales.createImageBitmap;
  else delete scope.createImageBitmap;
  if (originales.document) scope.document = originales.document;
  else delete scope.document;
  if (originales.Image) scope.Image = originales.Image;
  else delete scope.Image;
  URL.createObjectURL = originales.createObjectURL;
  URL.revokeObjectURL = originales.revokeObjectURL;
}

afterEach(restaurar);

function instalarDom(config: Config): Estado {
  const estado: Estado = {
    dibujos: [],
    bitmapOpciones: [],
    bitmaps: 0,
    cierres: 0,
    revocadas: 0,
    objectUrls: 0,
  };

  const canvas = () => {
    const elemento = {
      width: 0,
      height: 0,
      getContext(id: string) {
        assert.equal(id, "2d");
        if (config.contexto === "sin-contexto") return null;
        return {
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low",
          drawImage: () => undefined,
        };
      },
      toBlob(cb: (blob: Blob | null) => void, type?: string, quality?: number) {
        estado.dibujos.push({
          width: elemento.width,
          height: elemento.height,
          type: type ?? "",
          quality: quality ?? 0,
        });
        const bytes = config.bytes?.[estado.dibujos.length - 1] ?? 1_000;
        cb(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
      },
    };
    return elemento;
  };

  scope.document = {
    createElement: ((tag: string) => {
      assert.equal(tag, "canvas");
      return canvas() as unknown as HTMLCanvasElement;
    }) as Document["createElement"],
  } as unknown as Document;

  const bitmap = config.bitmap;
  if (bitmap) {
    scope.createImageBitmap = (async (_file: File, opciones?: ImageBitmapOptions) => {
      estado.bitmaps += 1;
      estado.bitmapOpciones.push(opciones);
      if (config.bitmapFallaPrimera && estado.bitmaps === 1) {
        throw new Error("orientación no admitida");
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        close: () => {
          estado.cierres += 1;
        },
      } as unknown as ImageBitmap;
    }) as unknown as typeof createImageBitmap;
  } else {
    delete scope.createImageBitmap;
  }

  scope.Image = class {
    width = config.imagen?.width ?? 800;
    height = config.imagen?.height ?? 1_200;
    src = "";
    async decode() {
      if (config.decodeFalla) throw new Error("archivo ilegible");
    }
  } as unknown as typeof Image;

  URL.createObjectURL = (() => {
    estado.objectUrls += 1;
    return "blob:portada";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {
    estado.revocadas += 1;
  }) as typeof URL.revokeObjectURL;

  return estado;
}

function archivo(bytes: number, type = "image/jpeg") {
  return new File([new Uint8Array(bytes)], "portada", { type });
}

test("un JPG que ya cumple se sube tal cual, sin recomprimir", async () => {
  const estado = instalarDom({ bitmap: { width: 800, height: 1_200 } });
  const original = archivo(1_000);

  const resultado = await prepareCover(original);

  assert.equal(resultado, original, "recomprimir sin necesidad solo pierde calidad");
  assert.equal(estado.dibujos.length, 0, "no se dibuja nada");
  assert.equal(estado.cierres, 1, "el mapa de bits se libera siempre");
});

test("una imagen que no es JPG se recomprime aunque ya quepa", async () => {
  const estado = instalarDom({ bitmap: { width: 800, height: 1_200 } });
  const original = archivo(1_000, "image/png");

  const resultado = await prepareCover(original);

  assert.notEqual(resultado, original);
  assert.equal(estado.dibujos.length, 1);
  assert.deepEqual(estado.dibujos[0], { width: 800, height: 1_200, type: "image/jpeg", quality: 0.85 });
});

test("una foto de móvil se reduce por el lado mayor", async () => {
  const estado = instalarDom({ bitmap: { width: 4_000, height: 3_000 } });

  const resultado = await prepareCover(archivo(8_000_000));

  assert.ok(resultado instanceof Blob);
  assert.deepEqual(estado.dibujos.map(({ width, height }) => `${width}x${height}`), ["1600x1200"]);
  assert.equal(estado.cierres, 1);
});

test("si el JPG sigue pesando mucho, primero baja la calidad y luego el tamaño", async () => {
  const estado = instalarDom({
    bitmap: { width: 4_000, height: 3_000 },
    // Tres intentos demasiado grandes y el cuarto que sí cabe.
    bytes: [MAX_COVER_BYTES + 1, MAX_COVER_BYTES + 1, MAX_COVER_BYTES + 1, 1_000],
  });

  const resultado = await prepareCover(archivo(9_000_000));

  assert.ok(resultado instanceof Blob);
  assert.deepEqual(
    estado.dibujos.map(({ width, height }) => `${width}x${height}`),
    ["1600x1200", "1600x1200", "1600x1200", "1200x900"],
    "el tamaño solo se toca después de agotar la calidad",
  );
  assert.deepEqual(
    estado.dibujos.map(({ quality }) => Number(quality.toFixed(2))),
    [0.85, 0.7, 0.55, 0.55],
    "la calidad baja antes que el tamaño",
  );
});

test("tras ocho intentos devuelve el último resultado, no el original gigante", async () => {
  const estado = instalarDom({
    bitmap: { width: 6_000, height: 4_000 },
    bytes: Array.from({ length: 8 }, () => MAX_COVER_BYTES + 1),
  });

  const resultado = await prepareCover(archivo(9_000_000));

  assert.ok(resultado instanceof Blob);
  assert.equal(estado.dibujos.length, 8);
  // El tamaño nunca baja de 400 px de lado mayor.
  assert.equal(estado.dibujos.at(-1)?.width, 400);
});

test("sin contexto 2D se falla con un mensaje claro y se libera el mapa de bits", async () => {
  const estado = instalarDom({ bitmap: { width: 4_000, height: 3_000 }, contexto: "sin-contexto" });

  await assert.rejects(() => prepareCover(archivo(9_000_000)), /No se pudo procesar la imagen/);
  assert.equal(estado.cierres, 1);
});

test("si `createImageBitmap` no admite la orientación, se reintenta sin opciones", async () => {
  const estado = instalarDom({ bitmap: { width: 800, height: 1_200 }, bitmapFallaPrimera: true });

  const resultado = await prepareCover(archivo(1_000));

  assert.ok(resultado instanceof Blob, "el reintento decodifica y la imagen se recomprime");
  assert.equal(estado.bitmaps, 2);
  assert.deepEqual(estado.bitmapOpciones[0], { imageOrientation: "from-image" });
  assert.equal(estado.bitmapOpciones[1], undefined);
});

test("con el camino alternativo (`<img>`) se revoca la URL temporal", async () => {
  const estado = instalarDom({ bitmap: null, imagen: { width: 800, height: 1_200 } });

  const resultado = await prepareCover(archivo(1_000));

  assert.equal(resultado instanceof Blob, true);
  assert.equal(estado.objectUrls, 1);
  assert.equal(estado.revocadas, 1, "la URL de objeto no puede quedarse viva");
});

test("un archivo que el navegador no puede decodificar se rechaza sin dejar la URL viva", async () => {
  const estado = instalarDom({ bitmap: null, decodeFalla: true });

  await assert.rejects(() => prepareCover(archivo(2_000)), /archivo ilegible/);
  assert.equal(estado.objectUrls, 1);
  assert.equal(estado.revocadas, 1);
});
