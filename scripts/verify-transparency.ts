/**
 * Verifica desde fuera la transparencia de una instancia.
 *
 *   npm run transparency:verify -- --url https://biblioteca.example.com
 *   npm run transparency:verify -- --url https://… --snapshot snp_… \
 *     --key-fingerprint <sha256> --pin <raíz>
 *
 * Descarga la instantánea publicada y su NDJSON, recalcula el hash y la raíz de
 * Merkle, comprueba la firma Ed25519 y que la cadena de raíces no tenga
 * eslabones rotos. Pensado para un testigo externo: `--key` fija la clave SPKI
 * completa y `--key-fingerprint` su SHA-256; `--pin` fija la raíz que vio antes
 * para esa misma instantánea y falla si la instancia la reescribe.
 *
 * No necesita la base ni el código del servidor: solo la URL pública.
 */
import {
  publicKeyFingerprint,
  verifyChain,
  verifyKeyChain,
  verifyKeySnapshotSignature,
  verifySnapshot,
  type KeySnapshot,
  type TransparencySnapshot,
} from "../src/lib/transparency";

type Args = {
  url: string;
  snapshot: string | null;
  pin: string | null;
  key: string | null;
  keyFingerprint: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    snapshot: null,
    pin: null,
    key: null,
    keyFingerprint: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      (flag === "--url" ||
        flag === "--snapshot" ||
        flag === "--pin" ||
        flag === "--key" ||
        flag === "--key-fingerprint") &&
      value
    ) {
      if (flag === "--url") args.url = value.replace(/\/+$/, "");
      if (flag === "--snapshot") args.snapshot = value;
      if (flag === "--pin") args.pin = value;
      if (flag === "--key") args.key = value;
      if (flag === "--key-fingerprint") args.keyFingerprint = value;
      index += 1;
      continue;
    }
    console.error(`Argumento no reconocido: ${flag}`);
    console.error(
      "Uso: --url https://… [--snapshot snp_…] [--pin <raíz>] [--key <spki-base64>] [--key-fingerprint <sha256>]",
    );
    process.exit(1);
  }
  return args;
}

type Index = {
  latest: TransparencySnapshot | null;
  snapshots: TransparencySnapshot[];
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} respondió HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = await getJson<Index>(`${args.url}/api/transparency`);
  const snapshot = args.snapshot
    ? index.snapshots.find((item) => item.id === args.snapshot)
    : index.latest;

  if (!snapshot) {
    throw new Error(
      args.snapshot
        ? `La instantánea ${args.snapshot} no está publicada.`
        : "La instancia no ha publicado ninguna instantánea.",
    );
  }

  const response = await fetch(
    `${args.url}/api/transparency/export?id=${encodeURIComponent(snapshot.id)}`,
  );
  if (!response.ok) {
    throw new Error(`La descarga del contenido respondió HTTP ${response.status}`);
  }
  const payload = await response.text();

  const problems: string[] = [];
  const checked = verifySnapshot(snapshot, payload, {
    publicKey: args.key ?? undefined,
    keyFingerprint: args.keyFingerprint ?? undefined,
  });
  problems.push(...checked.problems);

  if (args.pin && args.pin !== snapshot.merkleRoot) {
    problems.push(
      `la raíz de ${snapshot.id} cambió: se fijó ${args.pin} y ahora publica ${snapshot.merkleRoot}`,
    );
  }

  const chain = verifyChain(index.snapshots);
  problems.push(...chain.problems);

  // Directorio de claves: raíces firmadas, sin publicar qué clave tiene cada
  // cuenta. Se comprueba la firma de la última y que la cadena no se rompa.
  const keys = await getJson<{ snapshots: KeySnapshot[] }>(`${args.url}/api/transparency/keys`);
  const latestKey = keys.snapshots[0] ?? null;
  const keyChain = verifyKeyChain(keys.snapshots);
  problems.push(...keyChain.problems);
  if (latestKey && !verifyKeySnapshotSignature(latestKey, args.key ?? latestKey.publicKey ?? undefined)) {
    problems.push(`la instantánea del directorio ${latestKey.id} no verifica su firma`);
  }

  console.log(`Instancia:   ${args.url}`);
  console.log(`Instantánea: ${snapshot.id} (${snapshot.createdAt})`);
  console.log(`Obras:       ${snapshot.itemCount}`);
  console.log(`Raíz:        ${snapshot.merkleRoot}`);
  console.log(`Firma:       ${snapshot.signature ? "Ed25519" : "sin firmar"}`);
  const fingerprint = snapshot.publicKey ? publicKeyFingerprint(snapshot.publicKey) : null;
  console.log(`Clave:       ${fingerprint ?? "no disponible"}`);
  console.log(`Cadena:      ${chain.ok ? "íntegra" : "rota"}`);
  console.log(
    `Claves:      ${
      latestKey
        ? `${latestKey.itemCount} publicadas, ${latestKey.signature ? "firmadas" : "sin firmar"}, cadena ${
            keyChain.ok ? "íntegra" : "rota"
          }`
        : "sin instantáneas del directorio"
    }`,
  );

  if (problems.length > 0) {
    console.error("\nPROBLEMAS:");
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
  console.log("\nTodo cuadra.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
