/**
 * Textos legales: política de privacidad (art. 13 RGPD) y aviso legal
 * (Impressum, § 5 DDG).
 *
 * ⚠️ Los datos del responsable NO están en el código: llegan por entorno
 * (`LEGAL_CONTROLLER`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_VAT_ID`).
 * Si faltan, la página lo dice abiertamente en vez de inventar una dirección, y
 * `env-check` avisa al arrancar en producción.
 *
 * El contenido describe lo que hace el código (qué se guarda, cuánto vive y qué
 * terceros intervienen). Antes de abrir el servicio hay que revisarlo con quien
 * asuma la responsabilidad legal y ajustarlo a la forma jurídica real.
 */

import { imprintDocumentEN, privacyDocumentEN } from "./legal-en";
import type { Locale } from "./i18n";

export type LegalSection = { heading: string; body: string[] };
export type LegalDocument = {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
};

export type LegalConfig = {
  controller: string;
  address: string;
  contact: string;
  vatId: string;
  /** Teléfono opcional: § 5 DDG pide un medio de contacto rápido; el correo basta. */
  phone: string;
  /** Registro público (asociación, mercantil…) y su número, si aplica. */
  register: string;
  complete: boolean;
};

export function legalConfig(env: Record<string, string | undefined> = process.env): LegalConfig {
  const controller = env.LEGAL_CONTROLLER?.trim() ?? "";
  const address = env.LEGAL_ADDRESS?.trim() ?? "";
  const contact = env.LEGAL_CONTACT_EMAIL?.trim() ?? "";
  const vatId = env.LEGAL_VAT_ID?.trim() ?? "";
  const phone = env.LEGAL_PHONE?.trim() ?? "";
  const register = env.LEGAL_REGISTER?.trim() ?? "";
  return {
    controller,
    address,
    contact,
    vatId,
    phone,
    register,
    complete: Boolean(controller && address && contact),
  };
}

/** Fecha de la última revisión del texto. */
const UPDATED = "2026-11-04";

/**
 * Dirección de contacto tal y como se publica: `nombre[at]dominio`.
 *
 * El aviso legal obliga a dar un medio de contacto, pero una dirección escrita
 * con su `@` es lo primero que recogen los rastreadores de correo. Con `[at]`
 * se lee igual y el robot que copia el HTML se queda con una cadena que no es
 * una dirección.
 */
export function maskContact(contact: string): string {
  const limpio = contact.trim();
  const arroba = limpio.lastIndexOf("@");
  if (arroba < 1 || arroba === limpio.length - 1) return limpio;
  return `${limpio.slice(0, arroba)}[at]${limpio.slice(arroba + 1)}`;
}

const CONTROLLER_PLACEHOLDER_ES =
  "Pendiente de configurar: define LEGAL_CONTROLLER, LEGAL_ADDRESS y LEGAL_CONTACT_EMAIL en el entorno del servicio.";
const CONTROLLER_PLACEHOLDER_DE =
  "Noch nicht konfiguriert: LEGAL_CONTROLLER, LEGAL_ADDRESS und LEGAL_CONTACT_EMAIL in der Dienstumgebung setzen.";

export function privacyDocument(locale: Locale, config: LegalConfig): LegalDocument {
  if (locale === "en") return privacyDocumentEN(config);
  const responsible = config.complete
    ? [config.controller, config.address, maskContact(config.contact)].filter(Boolean)
    : [locale === "de" ? CONTROLLER_PLACEHOLDER_DE : CONTROLLER_PLACEHOLDER_ES];

  if (locale === "de") {
    return {
      title: "Datenschutzerklärung",
      updated: UPDATED,
      intro: [
        "Diese Erklärung beschreibt, welche personenbezogenen Daten Wanderbibliothek verarbeitet, warum, wie lange und an wen sie übermittelt werden.",
        "Grundlage sind die tatsächlichen Abläufe dieser Anwendung: Jede Angabe hier entspricht dem, was der Code speichert.",
      ],
      sections: [
        { heading: "1. Verantwortlicher", body: responsible },
        {
          heading: "2. Welche Daten wir verarbeiten",
          body: [
            "Konto: Name, E-Mail-Adresse, Stadt, kurze Biografie und Sprache. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).",
            "Passwort: nur als scrypt-Hash gespeichert, niemals im Klartext. Sitzungen: ein zufälliges Token, in der Datenbank ebenfalls nur als Hash.",
            "Bücher und Tauschvorgänge: Titel, Zustand, Stadt, Anfragen, Abholcodes und Bewertungen. Notizen zum Exemplar sind freiwillig.",
            "Nachrichten: werden im Browser verschlüsselt (siehe Punkt 7). Der Server speichert nur den verschlüsselten Text sowie die Metadaten (wer, mit wem, wann).",
            "IP-Adresse: ausschließlich zur Begrenzung von Anfragen und zum Schutz vor Passwort-Angriffen, und nur als tagesaktueller Pseudonym gespeichert, nicht als Adresse.",
            "E-Mail-Versand: Für Bestätigung, Passwort-Reset und Benachrichtigungen. Die Benachrichtigungen lassen sich im Konto abschalten.",
            "Die Angaben sind für die Nutzung erforderlich: Ohne Name, E-Mail-Adresse und Passwort kann kein Konto angelegt werden. Es gibt keine automatisierte Entscheidungsfindung und kein Profiling mit rechtlicher Wirkung.",
          ],
        },
        {
          heading: "3. Speicherdauer",
          body: [
            "Sitzungen: 14 Tage, höchstens 30 Tage ab Anmeldung.",
            "Bestätigungs- und Reset-Links: 24 Stunden bzw. 1 Stunde; sie sind einmalig gültig.",
            "Versandte E-Mails: 7 Tage nach Zustellung.",
            "IP-Pseudonyme: höchstens 1 Tag.",
            "Benachrichtigungen: 90 Tage nach dem Lesen, spätestens 180 Tage nach Entstehung. Aktivität im öffentlichen Bereich und in Clubs: 180 Tage.",
            "Moderationsprotokoll: bis zu 730 Tage (konfigurierbar).",
            "Konto und Profil: bis zur Löschung des Kontos.",
            "Server-Logs: IP-Adresse, Pfad ohne Query-String und Antwortcode, gemäß der Rotation des Systems (logrotate, standardmäßig 14 Tage). Suchbegriffe und Einmal-Links werden nicht protokolliert.",
          ],
        },
        {
          heading: "4. Empfänger und Drittanbieter",
          body: [
            "E-Mail-Anbieter: In diesem Dienst Brevo (Sendinblue SAS, Paris), der die Daten weisungsgebunden und innerhalb der EU verarbeitet; erhält Adresse und Inhalt der Benachrichtigungs-E-Mail, niemals den Inhalt verschlüsselter Nachrichten.",
            "Buchcover: Die Bilder werden über unseren Server geladen und zwischengespeichert; die Open Library (Internet Archive) sieht dabei die IP des Servers und die ISBN, nicht die IP der Besucherin oder des Besuchers.",
            "Weitere Buchdaten: zur Vervollständigung der bibliografischen Angaben fragt der Server die Deutsche Nationalbibliothek (services.dnb.de) und, als Ausweichquelle für Cover, Google Books (Google Ireland Ltd.) — beide erhalten nur die ISBN und die IP des Servers.",
            "Ortsnamen: den von der Person eingegebenen Ortsnamen gleicht der Server mit Nominatim (OpenStreetMap Foundation) ab, um Tippfehler zu erkennen. Übertragen wird nur der Ortsname, keine IP-Adresse der Besucherin oder des Besuchers.",
            "Cloudflare Turnstile: nur wenn aktiviert, beim Registrieren.",
            "Hosting: der Anbieter, bei dem dieser Dienst läuft.",
            "Es gibt keine Analyse-, Werbe- oder Tracking-Dienste und keine externen Schriftarten.",
            "Drittlandbezug: Findet die Verarbeitung durch einen Dienstleister außerhalb des EWR statt (z. B. ein E-Mail-Anbieter in den USA), stützt sie sich auf die Standardvertragsklauseln der EU-Kommission oder einen Angemessenheitsbeschluss. Welcher Anbieter eingesetzt wird, ergibt sich aus der Konfiguration des Dienstes.",
          ],
        },
        {
          heading: "5. Cookies und lokale Speicherung",
          body: [
            "Zwei technisch notwendige Cookies: die Sitzung (HttpOnly, Secure, SameSite=Lax, 14 Tage) und, nur wenn die Sprache manuell gewechselt wird, die Spracheinstellung (1 Jahr). Keines dient Werbung oder Analyse und keines verlangt eine Einwilligung.",
            "Im Browser gespeichert: gewähltes Design und Sprache sowie die Fingerabdrücke der Schlüssel der Gesprächspartner.",
            "Die private Schlüsselhälfte für die Verschlüsselung liegt im IndexedDB des Browsers und lässt sich von JavaScript nicht auslesen.",
          ],
        },
        {
          heading: "6. Sichtbarkeit der Daten",
          body: [
            "Das Profil (Name, Stadt, Biografie, Bücher) ist für angemeldete Personen sichtbar; daraus lebt die Gemeinschaft.",
            "Suchmaschinen dürfen den Katalog und die Profile nicht indexieren (robots.txt), und der Katalog ist ohne Anmeldung nicht mehr erreichbar.",
          ],
        },
        {
          heading: "7. Verschlüsselte Nachrichten",
          body: [
            "Nachrichten werden Ende-zu-Ende verschlüsselt (ECDH P-256 + AES-GCM). Betreiber und Server können sie nicht lesen.",
            "Der Preis dafür: Geht der Browser-Speicher verloren, sind alte Nachrichten nicht wiederherstellbar.",
          ],
        },
        {
          heading: "8. Ihre Rechte",
          body: [
            "Auskunft und Datenübertragbarkeit: „Daten herunterladen“ im Konto erzeugt eine JSON-Datei mit allen gespeicherten Angaben.",
            "Berichtigung: Name, Stadt und Biografie lassen sich jederzeit ändern.",
            "Löschung: „Konto löschen“ anonymisiert das Konto und entfernt Sitzungen, Benachrichtigungen, Listen, eigene Clubs, Blockierungen, Lesezeichen und persönliche Notizen. Nachrichten und Bewertungen bleiben mit anonymisiertem Autor erhalten, weil sie zum Verlauf anderer Personen gehören.",
            "Widerspruch gegen Benachrichtigungs-E-Mails: jederzeit im Konto.",
            "Beschwerde: bei der für dich zuständigen Datenschutz-Aufsichtsbehörde deines Bundeslandes.",
            "Einschränkung der Verarbeitung: Solange ein Widerspruch oder eine Löschung geprüft wird, können Sie die Verarbeitung einschränken lassen; melden Sie sich dafür bei der oben genannte Kontaktadresse.",
            "Widerruf: Eine erteilte Einwilligung – etwa in Benachrichtigungs-E-Mails – lässt sich jederzeit ohne Angabe von Gründen widerrufen, im Konto oder per E-Mail; die Rechtmäßigkeit der bisherigen Verarbeitung bleibt davon unberührt.",
          ],
        },
        {
          heading: "9. Sicherungskopien",
          body: [
            "Von der Datenbank werden täglich Sicherungskopien erstellt. Sie können Daten enthalten, die inzwischen gelöscht wurden, und werden nach 14 Tagen überschrieben.",
          ],
        },
        {
          heading: "10. Mindestalter",
          body: [
            "Die Nutzung ist ab 16 Jahren möglich. Bei der Registrierung wird das ausdrücklich bestätigt; eine Altersprüfung findet nicht statt.",
          ],
        },
        {
          heading: "11. Änderungen",
          body: [
            "Wenn sich die Verarbeitung ändert, wird dieser Text aktualisiert. Das Datum oben nennt den Stand.",
          ],
        },
      ],
    };
  }

  return {
    title: "Política de privacidad",
    updated: UPDATED,
    intro: [
      "Esta política describe qué datos personales trata Wanderbibliothek, para qué, durante cuánto tiempo y a quién se comunican.",
      "Se basa en lo que hace realmente la aplicación: cada dato que se menciona aquí es el que el código guarda.",
    ],
    sections: [
      { heading: "1. Responsable del tratamiento", body: responsible },
      {
        heading: "2. Qué datos tratamos",
        body: [
          "Cuenta: nombre, correo, ciudad, biografía breve e idioma. Base jurídica: ejecución del contrato (art. 6.1.b RGPD).",
          "Contraseña: solo se guarda su hash scrypt, nunca en claro. Sesiones: un token aleatorio que en la base también queda como hash.",
          "Libros e intercambios: título, estado, ciudad, solicitudes, códigos de entrega y valoraciones. Las notas del ejemplar son voluntarias.",
          "Mensajes: se cifran en el navegador (punto 7). El servidor guarda solo el texto cifrado y los metadatos (quién, con quién, cuándo).",
          "Dirección IP: únicamente para limitar peticiones y frenar ataques de contraseña, y guardada como pseudónimo diario, no como dirección.",
          "Correo electrónico: para confirmar la cuenta, restablecer la contraseña y avisar de actividad. Los avisos se pueden desactivar en la cuenta.",
          "Estos datos son necesarios para prestar el servicio: sin nombre, correo y contraseña no se puede crear la cuenta. No hay decisiones automatizadas ni elaboración de perfiles con efectos jurídicos sobre la persona.",
        ],
      },
      {
        heading: "3. Plazos de conservación",
        body: [
          "Sesiones: 14 días, con un máximo de 30 desde el acceso.",
          "Enlaces de confirmación y restablecimiento: 24 horas y 1 hora; son de un solo uso.",
          "Correos enviados: 7 días tras la entrega.",
          "Pseudónimos de IP: como máximo 1 día.",
          "Avisos: 90 días tras leerse y 180 como máximo. Actividad pública y de clubes: 180 días.",
          "Auditoría de moderación: hasta 730 días (configurable).",
          "Cuenta y perfil: hasta que se borra la cuenta.",
          "Registros del servidor: dirección IP, ruta sin la cadena de consulta y código de respuesta, según la rotación del sistema (`logrotate`, 14 días por defecto). No se registran las búsquedas ni los enlaces de un solo uso.",
        ],
      },
      {
        heading: "4. Destinatarios y terceros",
        body: [
          "Proveedor de correo: en este servicio, Brevo (Sendinblue SAS, París), que trata los datos por nuestra cuenta y dentro de la UE; recibe la dirección y el texto del aviso, nunca el contenido de los mensajes cifrados.",
          "Portadas de libros: se descargan a través de nuestro servidor y se cachean; Open Library (Internet Archive) ve la IP del servidor y el ISBN, no la de quien navega.",
          "Otros datos del libro: para completar la ficha, el servidor consulta la Deutsche Nationalbibliothek (services.dnb.de) y, como fuente alternativa de portadas, Google Books (Google Ireland Ltd.); ambos reciben solo el ISBN y la IP del servidor.",
          "Nombres de municipio: el que escribe la persona se contrasta con Nominatim (OpenStreetMap Foundation) para detectar erratas. Se envía solo el nombre del municipio, nunca la IP de quien navega.",
          "Cloudflare Turnstile: solo si está activado, al registrarse.",
          "Alojamiento: el proveedor donde se ejecuta el servicio.",
          "No hay servicios de analítica, publicidad ni seguimiento, ni fuentes externas.",
          "Transferencias internacionales: si un proveedor trata datos fuera del EEE (por ejemplo, un servicio de correo en Estados Unidos), se ampara en las cláusulas contractuales tipo de la Comisión Europea o en una decisión de adecuación. Qué proveedor se usa consta en la configuración del servicio.",
        ],
      },
      {
        heading: "5. Cookies y almacenamiento local",
        body: [
          "Dos cookies técnicas: la de sesión (HttpOnly, Secure, SameSite=Lax, 14 días) y, solo si se cambia el idioma a mano, la de idioma (1 año). Ninguna sirve para publicidad ni analítica, y ninguna requiere consentimiento.",
          "En el navegador se guardan el tema y el idioma elegidos, y las huellas de las claves de tus interlocutores.",
          "La mitad privada de la clave de cifrado vive en IndexedDB y JavaScript no puede extraerla.",
        ],
      },
      {
        heading: "6. Visibilidad de los datos",
        body: [
          "El perfil (nombre, ciudad, biografía, libros) es visible para personas con sesión iniciada: de ahí vive la comunidad.",
          "Los buscadores no pueden indexar el catálogo ni los perfiles (robots.txt), y el catálogo ya no es accesible sin cuenta.",
        ],
      },
      {
        heading: "7. Mensajes cifrados",
        body: [
          "Los mensajes se cifran de extremo a extremo (ECDH P-256 + AES-GCM). Ni el servidor ni quien lo administra pueden leerlos.",
          "El precio: si se pierden los datos del navegador, los mensajes antiguos no se pueden recuperar.",
        ],
      },
      {
        heading: "8. Tus derechos",
        body: [
          "Acceso y portabilidad: «Descargar datos» en la cuenta genera un JSON con todo lo guardado.",
          "Rectificación: nombre, ciudad y biografía se cambian cuando quieras.",
          "Supresión: «Borrar cuenta» anonimiza la cuenta y elimina sesiones, avisos, listas, clubes propios, bloqueos, favoritos y notas personales. Los mensajes y valoraciones se conservan con el autor ya anonimizado porque forman parte del historial de otras personas.",
          "Oposición a los correos de aviso: en cualquier momento desde la cuenta.",
          "Reclamación: ante la autoridad de protección de datos de tu estado federado.",
          "Limitación del tratamiento: mientras se resuelve una oposición o un borrado, puedes pedir que se limite el tratamiento escribiendo a la dirección de contacto de arriba.",
          "Retirada del consentimiento: si diste tu consentimiento para algo —por ejemplo, los correos de aviso— puedes retirarlo en cualquier momento sin dar motivos, desde la cuenta o por correo; la licitud del tratamiento anterior no queda afectada.",
        ],
      },
      {
        heading: "9. Copias de seguridad",
        body: [
          "Cada día se hace una copia de la base de datos. Puede contener datos ya borrados y se sobrescribe a los 14 días.",
        ],
      },
      {
        heading: "10. Edad mínima",
        body: [
          "El servicio es para mayores de 16 años. Al registrarse se declara expresamente; no se verifica la edad.",
        ],
      },
      {
        heading: "11. Cambios",
        body: ["Si cambia el tratamiento, se actualiza este texto. La fecha de arriba indica la versión."],
      },
    ],
  };
}

export function imprintDocument(locale: Locale, config: LegalConfig): LegalDocument {
  if (locale === "en") return imprintDocumentEN(config);
  const de = locale === "de";
  // § 5 DDG pide nombre, dirección y un medio de contacto rápido; el registro y
  // el NIF/IVA solo cuando existan.
  const details = config.complete
    ? [
        `${de ? "Anbieter" : "Titular"}: ${config.controller}`,
        `${de ? "Anschrift" : "Dirección"}: ${config.address}`,
          `${de ? "Kontakt" : "Contacto"}: ${maskContact(config.contact)}`,
        ...(config.phone ? [`${de ? "Telefon" : "Teléfono"}: ${config.phone}`] : []),
        ...(config.register ? [`${de ? "Registereintrag" : "Registro"}: ${config.register}`] : []),
        ...(config.vatId ? [`${de ? "USt-IdNr." : "NIF/IVA"}: ${config.vatId}`] : []),
      ]
    : [de ? CONTROLLER_PLACEHOLDER_DE : CONTROLLER_PLACEHOLDER_ES];

  if (locale === "de") {
    return {
      title: "Impressum",
      updated: UPDATED,
      intro: ["Angaben gemäß § 5 DDG."],
      sections: [
        { heading: "Diensteanbieter", body: details },
        {
          heading: "Verantwortlich für den Inhalt",
          body: [config.controller || (locale === "de" ? CONTROLLER_PLACEHOLDER_DE : CONTROLLER_PLACEHOLDER_ES)],
        },
        {
          heading: "Haftung für Inhalte und Links",
          body: [
            "Die Inhalte stammen von den Nutzerinnen und Nutzern. Für fremde Inhalte wird erst ab Kenntnis einer Rechtsverletzung gehaftet; dann werden sie entfernt.",
            "Für Inhalte externer Seiten sind deren Betreiber verantwortlich.",
          ],
        },
      ],
    };
  }

  return {
    title: "Aviso legal",
    updated: UPDATED,
    intro: ["Datos identificativos del prestador del servicio."],
    sections: [
      { heading: "Titular del servicio", body: details },
      {
        heading: "Responsable del contenido",
        body: [config.controller || CONTROLLER_PLACEHOLDER_ES],
      },
      {
        heading: "Responsabilidad sobre contenidos y enlaces",
        body: [
          "Los contenidos los publican las personas usuarias. Solo se responde de contenidos ajenos desde que se conoce una infracción; en ese momento se retiran.",
          "De los contenidos de páginas externas responden sus titulares.",
        ],
      },
    ],
  };
}
