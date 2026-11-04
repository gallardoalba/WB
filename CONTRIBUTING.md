# Cómo contribuir

Gracias por el interés. Este documento resume lo necesario para que un cambio se
pueda revisar y aceptar rápido.

## Entorno

- Node.js **22** (hay `.nvmrc`).
- `npm ci` (incluye devDependencies: el build necesita TypeScript y Tailwind).
- `npm run dev` arranca en `http://localhost:3000` con **datos de demostración**
  (cuentas `@wanderbibliothek.test`, contraseña `demo1234`). Para no sembrarlos,
  `SEED_DEMO=0 npm run dev`.

## Antes de abrir un pull request

Todo esto tiene que pasar; el CI ejecuta lo mismo:

```bash
npm run typecheck   # next typegen + tsc
npm run lint
npm test            # 188 pruebas, SQLite en memoria
npm run build
npm run test:e2e    # Playwright; la primera vez: npx playwright install chromium
```

`npm run test:e2e` levanta su propio servidor en `localhost:3100`. Si ya tienes
`npm run dev` en marcha, usa `PLAYWRIGHT_BASE_URL=http://localhost:3000
npm run test:e2e` (Next no permite dos instancias de desarrollo en el mismo
directorio).

## Convenciones del proyecto

- **Commits** en español, con una primera línea que diga *qué* cambia y un cuerpo
  breve con el *porqué* y la validación ejecutada. Ejemplo:

  ```
  Avisa al aceptar si el ejemplar ya no está disponible

  El servidor lo comprobaba, pero la interfaz seguía mostrando «Aceptar»
  hasta que llegaba el 409.

  Validado: tsc, eslint, 188 tests, build y 18/18 E2E.
  ```

- **Idioma de la interfaz**: los textos se escriben en español y el diccionario
  alemán de `src/lib/i18n.ts` usa ese texto como clave. `tests/i18n.test.ts`
  falla si una cadena usada con `t()` no tiene traducción: añade siempre la
  entrada alemana. Si el texto depende de un mapa de etiquetas, tipa el mapa con
  `MessageKey` (`satisfies Record<…, MessageKey>`) para que el compilador lo
  detecte.
- **Base de datos**: cualquier cambio de esquema es una migración nueva en
  `src/lib/db.ts` (`SCHEMA_VERSION` + `migrateToVNN`) y un test que la ejercite.
  Nunca se edita una migración ya publicada.
- **Fechas**: no leas el reloj en el render; usa `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  de SQLite (Next trata `Date.now()` como valor inestable al prerenderizar).
- **Seguridad por defecto**: toda mutación de `src/app/api` pasa por `guard()`
  (origen + cuota) o justifica su excepción; `tests/contracts.test.ts` lo
  comprueba. El cuerpo se lee con `readJson()` (exige `application/json` y corta
  en 64 KB) y los errores se devuelven con `handleApiError()`.
- **Estilos**: tokens de `src/app/styles/tokens.css`; nada de colores literales en
  los componentes, porque el modo oscuro comparte el mismo marcado.
- **Accesibilidad**: los controles nuevos deben ser operables con teclado y con
  nombre accesible; hay pruebas de teclado en `e2e/app.spec.ts`.

## Qué no incluir en un PR

- Ficheros de `.data/`, bases de datos, copias, `.env` reales, capturas con datos
  personales o tokens.
- Cambios de dependencias sin justificación (el CI audita `npm audit --omit=dev`).
- Refactorizaciones amplias mezcladas con arreglos funcionales: mejor PRs
  pequeños.

## Despliegue

No hace falta para contribuir; si te interesa, la guía está en
[`deploy/README.md`](deploy/README.md) (systemd + nginx) y en el `Dockerfile`.
