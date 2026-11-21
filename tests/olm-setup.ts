/**
 * Carga libolm en las pruebas (Node).
 *
 * El código de protocolo ya no importa el paquete —el empaquetador del
 * navegador no puede resolver sus ramas de Node—, así que quien lo ejecuta
 * fuera del navegador tiene que inyectarlo. Aquí se hace una vez por proceso.
 */
import Olm from "@matrix-org/olm";

import { setOlm, type OlmFactory } from "../src/lib/olm-runtime.ts";

setOlm(Olm as unknown as OlmFactory);
