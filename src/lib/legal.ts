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
  emailProvider: "brevo" | "webhook" | null;
  turnstileWidgetEnabled: boolean;
  turnstileVerificationEnabled: boolean;
  webPushEnabled: boolean;
  errorWebhookEnabled: boolean;
  complete: boolean;
};

export function legalConfig(env: Record<string, string | undefined> = process.env): LegalConfig {
  const controller = env.LEGAL_CONTROLLER?.trim() ?? "";
  const address = env.LEGAL_ADDRESS?.trim() ?? "";
  const contact = env.LEGAL_CONTACT_EMAIL?.trim() ?? "";
  const vatId = env.LEGAL_VAT_ID?.trim() ?? "";
  const phone = env.LEGAL_PHONE?.trim() ?? "";
  const register = env.LEGAL_REGISTER?.trim() ?? "";
  const emailProvider = env.MAIL_WEBHOOK_URL?.trim()
    ? "webhook"
    : env.BREVO_API_KEY?.trim() && env.MAIL_FROM?.trim()
      ? "brevo"
      : null;
  return {
    controller,
    address,
    contact,
    vatId,
    phone,
    register,
    emailProvider,
    turnstileWidgetEnabled: Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
    turnstileVerificationEnabled: Boolean(env.TURNSTILE_SECRET?.trim()),
    webPushEnabled: Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim()),
    errorWebhookEnabled: Boolean(env.ERROR_WEBHOOK_URL?.trim()),
    complete: Boolean(controller && address && contact),
  };
}

/** Fecha de la última revisión del texto. */
const UPDATED = "2026-11-20";

/**
 * Dirección de contacto tal y como se publica: `nombre[at]dominio[dot]tld`.
 *
 * El aviso legal obliga a dar un medio de contacto, pero una dirección escrita
 * con su `@` es lo primero que recogen los rastreadores de correo. Con `[at]` y
 * `[dot]` se lee igual y el robot que copia el HTML se queda con una cadena que
 * no es una dirección. Los puntos del usuario (`nombre.apellido`) se dejan: la
 * parte que hay que esconder es el dominio completo, que es lo que reconstruye
 * una dirección a partir de un `@` suelto.
 */
export function maskContact(contact: string): string {
  const limpio = contact.trim();
  const arroba = limpio.lastIndexOf("@");
  if (arroba < 1 || arroba === limpio.length - 1) return limpio;
  const usuario = limpio.slice(0, arroba);
  const dominio = limpio.slice(arroba + 1).replace(/\./g, "[dot]");
  return `${usuario}[at]${dominio}`;
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
  const german = locale === "de";
  const emailRecipient =
    config.emailProvider === "brevo"
      ? german
        ? "E-Mail-Anbieter: Brevo (Sendinblue SAS) erhält Empfängeradresse, Betreff und Inhalt der E-Mail."
        : "Correo electrónico: Brevo (Sendinblue SAS) recibe la dirección, el asunto y el contenido del mensaje."
      : config.emailProvider === "webhook"
        ? german
          ? "E-Mail-Versand: Der konfigurierte Mail-Webhook erhält Empfängeradresse, Betreff und vollständigen Nachrichtentext; der Betreiber bestimmt den dahinterliegenden Anbieter."
          : "Correo electrónico: el webhook configurado recibe la dirección, el asunto y el texto completo; quien administra el servicio elige el proveedor que hay detrás."
        : null;
  const optionalRecipients: string[] = [];
  if (config.turnstileWidgetEnabled || config.turnstileVerificationEnabled) {
    const turnstileDetails = [
      ...(config.turnstileWidgetEnabled
        ? [
            german
              ? "Der Browser lädt das Widget bei der Registrierung; Cloudflare erhält Verbindungsdaten."
              : "El navegador carga el widget al registrarse y Cloudflare recibe datos de conexión.",
          ]
        : []),
      ...(config.turnstileVerificationEnabled
        ? [
            german
              ? "Die Serverprüfung sendet das Token an Cloudflare und kann die IP-Adresse enthalten."
              : "La verificación del servidor envía el token a Cloudflare y puede incluir la dirección IP.",
          ]
        : []),
    ];
    optionalRecipients.push(`Cloudflare Turnstile: ${turnstileDetails.join(" ")}`);
  }
  if (config.webPushEnabled) {
    optionalRecipients.push(
      german
        ? "Web Push: Erst nach Aktivierung und Browser-Berechtigung speichert der Server Endpunkt, Schlüssel und User-Agent. Der Push-Dienst des Browsers (z. B. Google/FCM, Mozilla, Apple oder Microsoft) erhält verschlüsselte Zustellinhalte und Zustellmetadaten und kann auch Verbindungsdaten des Browsers, einschließlich der IP-Adresse, verarbeiten."
        : "Web Push: solo tras activarlo y conceder permiso, el servidor guarda el endpoint, las claves de suscripción y el agente de usuario. El servicio push del navegador (por ejemplo, Google/FCM, Mozilla, Apple o Microsoft) recibe el contenido cifrado y los metadatos de entrega, y también puede tratar datos de conexión del navegador, incluida la dirección IP.",
    );
  }
  if (config.errorWebhookEnabled) {
    optionalRecipients.push(
      german
        ? "Fehler-Webhook: Der konfigurierte Endpunkt erhält redigierte Server-Fehlerdaten (Zeitpunkt, Nachricht, Stack und Kontext); E-Mail-Adressen, Tokens und Anfrageinhalte werden vor dem Versand redigiert."
        : "Webhook de errores: el endpoint configurado recibe datos redactados de errores del servidor (fecha, mensaje, traza y contexto); se redactan correos, tokens y cuerpos de solicitudes antes del envío.",
    );
  }

  if (locale === "de") {
    return {
      title: "Datenschutzerklärung",
      updated: UPDATED,
      intro: [
        "Diese Erklärung beschreibt, welche personenbezogenen Daten Wanderbibliothek verarbeitet, warum, wie lange und an wen sie übermittelt werden.",
        "Sie beschreibt die Abläufe des Codes. Welche optionalen Dienste aktiv sind, wird aus der Konfiguration dieser Instanz abgeleitet; deren Betreiber muss konkrete Anbieter, Standorte, Rechtsgrundlagen und Übermittlungsmechanismen prüfen.",
      ],
      sections: [
        { heading: "1. Verantwortlicher", body: responsible },
        {
          heading: "2. Welche Daten wir verarbeiten",
          body: [
            "Konto: Name, E-Mail-Adresse, Stadt, kurze Biografie und Sprache. Rechtsgrundlage: Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).",
            "Passwort: nur als scrypt-Hash gespeichert, niemals im Klartext. Sitzungen: ein zufälliges Token, in der Datenbank ebenfalls nur als Hash.",
            "Bücher und Tauschvorgänge: Titel, Zustand, Stadt, Anfragen und Bewertungen. Notizen zum Exemplar sind freiwillig. Hochgeladene Cover werden öffentlich mit dem Werk verknüpft; Bildmetadaten werden vor dem Speichern oder Ausliefern entfernt.",
            "Nachrichten: werden im Browser verschlüsselt (siehe Punkt 7). Der Server speichert den verschlüsselten Text sowie die Metadaten (wer, mit wem, wann); unverschlüsselte Nachrichten nimmt er nicht an.",
            "Moderation: Meldungen, Sanktionen mit Grund und Frist sowie Einsprüche samt Name der prüfenden Person, auch wenn sie von außen kommt. Rechtsgrundlage: berechtigtes Interesse am Schutz der Personen und am geordneten Zusammenleben (Art. 6 Abs. 1 lit. f DSGVO).",
            "IP-Adresse: Für Ratenbegrenzung und Schutz vor Passwortangriffen speichert die Anwendungsdatenbank nur ein tagesaktuelles Pseudonym, nicht die Adresse selbst. Server-Zugriffsprotokolle können die IP-Adresse enthalten (siehe Speicherdauer).",
            "E-Mail-Versand: Für Bestätigung, Passwort-Reset und Benachrichtigungen. Die Benachrichtigungen lassen sich im Konto abschalten.",
            "Die Angaben sind für die Nutzung erforderlich: Ohne Name, E-Mail-Adresse und Passwort kann kein Konto angelegt werden. Es gibt keine automatisierte Entscheidungsfindung und kein Profiling mit rechtlicher Wirkung.",
          ],
        },
        {
          heading: "3. Speicherdauer",
          body: [
            "Sitzungen: 14 Tage, höchstens 30 Tage ab Anmeldung.",
            "Bestätigungs- und Reset-Links: 24 Stunden bzw. 1 Stunde; sie sind einmalig gültig. Der Einspruchslink: 30 Tage.",
            "E-Mail-Warteschlange: erledigte oder fehlgeschlagene Aufträge bis zu 7 Tage, offene oder laufende bis zu 30 Tage ab Erstellung. Die Aufbewahrung beim E-Mail-Anbieter richtet sich nach dessen Bedingungen.",
            ...(config.webPushEnabled
              ? ["Push-Abonnements: bis zur Abmeldung, Kontolöschung oder bis der Push-Dienst meldet, dass ein Endpunkt nicht mehr existiert; höchstens sechs Geräte je Konto."]
              : []),
            "IP-Pseudonyme: höchstens 1 Tag.",
            "Benachrichtigungen: 90 Tage nach dem Lesen, spätestens 180 Tage nach Entstehung. Aktivität im öffentlichen Bereich: 180 Tage.",
            "Moderationsprotokoll: bis zu 730 Tage (konfigurierbar). Sanktionen: solange sie aktiv sind; Grund und Frist werden beim Aufheben gelöscht.",
            "Entschiedene Einsprüche: 2 Jahre nach ihrer Einreichung.",
            "Erledigte Meldungen: 1 Jahr nach ihrer Einreichung.",
            "Konto und Profil: bis zur Löschung des Kontos.",
            "Server-Logs: IP-Adresse, Pfad ohne Query-String und Antwortcode, gemäß der Rotation des Systems (logrotate, standardmäßig 14 Tage). Suchbegriffe und Einmal-Links werden nicht protokolliert.",
          ],
        },
        {
          heading: "4. Empfänger und Drittanbieter",
          body: [
            ...(emailRecipient ? [emailRecipient] : []),
            "Bibliografische Daten: Der Server fragt die Deutsche Nationalbibliothek (services.dnb.de) und Open Library ab. Diese erhalten die ISBN und die IP des Servers, nicht die IP der besuchenden Person; Cover werden nicht von dort geladen.",
            "Ortsnamen: während des Tippens fragt der Server die Ortsliste bei Photon (Komoot GmbH) ab, einer Suche über die Daten von OpenStreetMap; anschließend gleicht er den gewählten Namen mit Nominatim (OpenStreetMap Foundation) ab, um Tippfehler zu erkennen. Übertragen wird nur der eingetippte Text bzw. der Ortsname, keine IP-Adresse der Besucherin oder des Besuchers.",
            ...optionalRecipients,
            "Hosting: netcup GmbH.",
            "Es gibt keine Analyse-, Werbe- oder Tracking-Dienste und keine externen Schriftarten.",
            "Internationale Übermittlungen: Die konkreten Empfänger und etwaige Übermittlungen außerhalb des EWR hängen von der Konfiguration ab. Der Betreiber dieser Instanz muss die eingesetzten Anbieter, deren Standorte und die jeweils geltenden Garantien angeben; der Anwendungscode kann diese Verträge nicht bestätigen.",
          ],
        },
        {
          heading: "5. Cookies und lokale Speicherung",
          body: [
            "Zwei technisch notwendige Cookies, keine weiteren: die Sitzung (HttpOnly, Secure, SameSite=Lax, 14 Tage) zur Anmeldung und, nur nach manuellem Sprachwechsel, die Spracheinstellung (1 Jahr). Keines dient Werbung oder Analyse, beide sind für den Dienst unbedingt erforderlich (Deutschland: § 25 Abs. 2 TDDDG; Österreich: § 165 Abs. 3 TKG 2021).",
            "Im Browser bleiben das gewählte Design, die ausgeblendete Einführung und die Fingerabdrücke der Gesprächsschlüssel gespeichert, bis die Websitedaten gelöscht werden; diese Werte werden nicht an den Server übertragen. Die ausgeblendete Checkliste wird im Konto gespeichert.",
            "Für die Ende-zu-Ende-Verschlüsselung speichert der Browser einen nicht exportierbaren privaten Schlüssel in IndexedDB. Der Server erhält ihn nicht; die Anwendung kann ihn für Verschlüsselungsoperationen verwenden. Nach Kontolöschung bleibt der lokale Schlüssel bestehen, bis die Websitedaten im Browser gelöscht werden.",
            "Der Service Worker wird in Produktion automatisch registriert, speichert keine Seitenantworten im Cache und dient der Push-Funktion. Push wird erst nach Aktivierung und Browser-Berechtigung abonniert; die Browser-Berechtigung allein ersetzt keine Information über die Datenverarbeitung.",
            ...(config.webPushEnabled
              ? ["Der Server speichert pro Push-Gerät Endpunkt, Zustellschlüssel und User-Agent. Die Inhalte werden für Web Push verschlüsselt; der Push-Dienst kann weiterhin Endpunkt, Zustellmetadaten und Verbindungsdaten des Browsers einschließlich IP-Adresse verarbeiten. Abmeldung und Kontolöschung entfernen das Abonnement; ungültige Endpunkte werden beim Versand gelöscht."]
              : []),
          ],
        },
        {
          heading: "6. Sichtbarkeit der Daten",
          body: [
            "Das Profil (Name, Stadt, Biografie, Bücher) ist für angemeldete Personen sichtbar; daraus lebt die Gemeinschaft.",
            "Du kannst wählen, wer dein Profil sieht (die ganze Gemeinschaft, nur Personen, denen du folgst, oder niemand), ob deine Stadt gezeigt wird, ob die Reise deiner Exemplare erzählt wird (Städte und Monate, nie Personen), ob du Bewertungen und Kommentare mit deinem Namen oder als «eine Person aus der Gemeinschaft» signierst und wer dir direkt schreiben darf. Die genaue Stadt bleibt bei einem angenommenen Tausch sichtbar, sonst kann man sich nicht treffen.",
            "Startseite und Katalog lassen sich auch ohne Konto ansehen und durchblättern. Ohne Anmeldung zeigt jedes Exemplar nur Buchangaben und Stadt: nie, wer es anbietet, die Notiz oder das genaue Datum. Mit Anmeldung kann der Eintrag die Reise des Exemplars erzählen: Städte und Monate, nie Personen.",
            "Katalog, Werkseiten, Leselisten, Leserverzeichnis und Profile sind mit `noindex` gekennzeichnet und stehen nicht in der Sitemap. Suchmaschinen müssen die Seiten dafür abrufen können; `robots.txt` ist kein Zugriffsschutz. Die Kennzeichnung verhindert keine Einsicht in öffentliche Inhalte und eine Entfernung aus bereits bestehenden Suchergebnissen kann dauern.",
          ],
        },
        {
          heading: "7. Verschlüsselte Nachrichten",
          body: [
            "Nachrichten werden Ende-zu-Ende verschlüsselt (ECDH P-256 + AES-GCM). Betreiber und Server können sie nicht lesen.",
            "Geht der Browser-Speicher verloren, sind alte Nachrichten nicht wiederherstellbar: der Server hat den Schlüssel nicht.",
          ],
        },
        {
          heading: "8. Ihre Rechte",
          body: [
            "Auskunft und Datenübertragbarkeit: „Daten herunterladen“ im Konto erzeugt eine JSON-Datei mit allen gespeicherten Angaben.",
            "Berichtigung: Name, Stadt und Biografie lassen sich jederzeit ändern.",
            "Löschung: „Konto löschen“ anonymisiert das Konto und entfernt Sitzungen, Benachrichtigungen, Listen, Blockierungen, Lesezeichen, persönliche Notizen und Bewertungen — auch die erhaltenen. Nachrichten zu Tauschvorgängen bleiben mit anonymisiertem Autor erhalten, weil sie zum Verlauf anderer Personen gehören; Direktnachrichten werden vollständig gelöscht, auch für die andere Person.",
            "Widerspruch gegen Benachrichtigungs-E-Mails: jederzeit im Konto.",
            "Beschwerde: bei der zuständigen Datenschutz-Aufsichtsbehörde. In Deutschland ist dies regelmäßig die Behörde des zuständigen Bundeslandes; in Österreich die Datenschutzbehörde (DSB).",
            "Einschränkung der Verarbeitung: Solange ein Widerspruch oder eine Löschung geprüft wird, können Sie die Verarbeitung einschränken lassen; melden Sie sich dafür bei der oben genannte Kontaktadresse.",
            "Widerruf: Eine erteilte Einwilligung – etwa in Benachrichtigungs-E-Mails – lässt sich jederzeit ohne Angabe von Gründen widerrufen, im Konto oder per E-Mail; die Rechtmäßigkeit der bisherigen Verarbeitung bleibt davon unberührt.",
          ],
        },
        {
          heading: "9. Sicherungskopien",
          body: [
            "Von der Datenbank wird alle sechs Stunden eine Sicherung erstellt. Sie kann inzwischen gelöschte Daten enthalten; aufbewahrt werden die 14 jüngsten Sicherungen (etwa dreieinhalb Tage) und in der externen Kopie 30.",
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
            "Wenn sich die Verarbeitung ändert, wird dieser Text aktualisiert.",
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
      "Describe los flujos del código. Los servicios opcionales se muestran según la configuración detectada en esta instalación; quien la administra debe comprobar los proveedores, ubicaciones, bases jurídicas y garantías de transferencia reales.",
    ],
    sections: [
      { heading: "1. Responsable del tratamiento", body: responsible },
      {
        heading: "2. Qué datos tratamos",
        body: [
          "Cuenta: nombre, correo, ciudad, biografía breve e idioma. Base jurídica: ejecución del contrato (art. 6.1.b RGPD).",
          "Contraseña: solo se guarda su hash scrypt, nunca en claro. Sesiones: un token aleatorio que en la base también queda como hash.",
          "Libros e intercambios: título, estado, ciudad, solicitudes y valoraciones. Las notas del ejemplar son voluntarias. Las portadas que suben las personas usuarias se asocian públicamente a la obra; el servidor elimina los metadatos de imagen antes de guardarlas o servirlas.",
          "Mensajes: se cifran en el navegador (punto 7). El servidor guarda el texto cifrado y los metadatos (quién, con quién, cuándo); no acepta mensajes sin cifrar.",
          "Moderación: denuncias, sanciones con su motivo y plazo, y apelaciones con el nombre de quien las revisó, aunque venga de fuera. Base jurídica: interés legítimo en proteger a las personas y mantener la convivencia (art. 6.1.f RGPD).",
          "Dirección IP: para limitar peticiones y frenar ataques de contraseña, la base de datos de la aplicación guarda un pseudónimo diario, no la dirección. Los registros de acceso del servidor pueden conservar la IP (véase el plazo de conservación).",
          "Correo electrónico: para confirmar la cuenta, restablecer la contraseña y avisar de actividad. Los avisos se pueden desactivar en la cuenta.",
          "Estos datos son necesarios para prestar el servicio: sin nombre, correo y contraseña no se puede crear la cuenta. No hay decisiones automatizadas ni elaboración de perfiles con efectos jurídicos sobre la persona.",
        ],
      },
      {
        heading: "3. Plazos de conservación",
        body: [
          "Sesiones: 14 días, con un máximo de 30 desde el acceso.",
          "Enlaces de confirmación y restablecimiento: 24 horas y 1 hora; son de un solo uso. El enlace de apelación: 30 días.",
          "Cola de correo: los trabajos terminados o fallidos se conservan hasta 7 días y los pendientes o en curso hasta 30 días desde su creación. La conservación del mensaje por el proveedor de correo depende de sus propias condiciones.",
          ...(config.webPushEnabled
            ? ["Suscripciones Push: hasta que la persona se dé de baja, borre su cuenta o el servicio Push indique que el endpoint ya no existe; máximo seis dispositivos por cuenta."]
            : []),
          "Pseudónimos de IP: como máximo 1 día.",
          "Avisos: 90 días tras leerse y 180 como máximo. Actividad pública: 180 días.",
          "Auditoría de moderación: hasta 730 días (configurable). Sanciones: mientras estén activas; el motivo y el plazo se borran al levantarse la sanción.",
          "Apelaciones resueltas: 2 años desde su presentación.",
          "Denuncias resueltas: 1 año desde su presentación.",
          "Cuenta y perfil: hasta que se borra la cuenta.",
          "Registros del servidor: dirección IP, ruta sin la cadena de consulta y código de respuesta, según la rotación del sistema (`logrotate`, 14 días por defecto). No se registran las búsquedas ni los enlaces de un solo uso.",
        ],
      },
      {
        heading: "4. Destinatarios y terceros",
        body: [
          ...(emailRecipient ? [emailRecipient] : []),
          "Datos bibliográficos: el servidor consulta la Deutsche Nationalbibliothek (services.dnb.de) y Open Library. Reciben el ISBN y la IP del servidor, no la IP de quien navega; las portadas ya no se descargan de esos servicios.",
          "Nombres de municipio: mientras se escribe, el servidor pide la lista de municipios a Photon (Komoot GmbH), un buscador sobre los datos de OpenStreetMap; después contrasta el nombre elegido con Nominatim (OpenStreetMap Foundation) para detectar erratas. Se envía solo el texto escrito o el nombre del municipio, nunca la IP de quien navega.",
          ...optionalRecipients,
          "Alojamiento: netcup GmbH.",
          "No hay servicios de analítica, publicidad ni seguimiento, ni tipografías externas.",
          "Transferencias internacionales: los destinatarios concretos y las transferencias fuera del EEE dependen de la configuración. Quien administra esta instalación debe indicar los proveedores empleados, sus ubicaciones y las garantías aplicables; el código no puede confirmar contratos ni mecanismos de transferencia.",
        ],
      },
      {
        heading: "5. Cookies y almacenamiento local",
        body: [
          "Dos cookies técnicas y ninguna más: la de sesión (HttpOnly, Secure, SameSite=Lax, 14 días) para iniciar sesión y, solo tras cambiar el idioma manualmente, la preferencia de idioma (1 año). Ninguna sirve para publicidad ni analítica, y ambas son estrictamente necesarias para el servicio (Alemania: § 25.2 TDDDG; Austria: § 165.3 TKG 2021).",
          "En el navegador permanecen el tema elegido, la guía descartada y las huellas de las claves de mensajería hasta que se borren los datos del sitio; estos valores no se envían al servidor. La lista de inicio descartada se guarda en la cuenta.",
          "Para el cifrado de extremo a extremo, el navegador guarda una clave privada no exportable en IndexedDB. El servidor no la recibe; la aplicación puede usarla para operaciones criptográficas. Tras borrar la cuenta, la clave local permanece hasta que se borren los datos del sitio en el navegador.",
          "En producción se registra automáticamente un service worker; no guarda respuestas de páginas en caché y se usa para la función Push. La suscripción Push solo se crea tras activarla y conceder permiso en el navegador; ese permiso no sustituye la información sobre el tratamiento de datos.",
          ...(config.webPushEnabled
            ? ["El servidor guarda por dispositivo Push el endpoint, las claves de entrega y el agente de usuario. El contenido se cifra para Web Push, aunque el proveedor puede tratar el endpoint, los metadatos de entrega y datos de conexión del navegador, incluida la IP. La baja y el borrado de cuenta eliminan la suscripción; los endpoints inválidos se eliminan al enviar."]
            : []),
        ],
      },
      {
        heading: "6. Visibilidad de los datos",
        body: [
          "El perfil (nombre, ciudad, biografía, libros) es visible para personas con sesión iniciada: de ahí vive la comunidad.",
          "Puedes elegir quién ve tu perfil (toda la comunidad, solo a quienes sigues o nadie), si tu ciudad se enseña, si se cuenta el recorrido de tus ejemplares (ciudades y meses, nunca personas), si firmas reseñas y comentarios con tu nombre o como «una persona de la comunidad», y quién puede escribirte por mensaje directo. La ciudad exacta se sigue viendo en un intercambio aceptado, porque sin ella no se puede quedar.",
          "La portada y el catálogo se pueden ver y recorrer sin cuenta. Sin sesión, cada ejemplar muestra el libro y la ciudad: nunca quién lo publica, su nota ni la fecha exacta. Con sesión, la ficha puede contar el recorrido de la copia: ciudades y meses, nunca las personas.",
          "El catálogo, las fichas de obra, las listas, el directorio de lectores y los perfiles llevan la indicación `noindex` y no se incluyen en el sitemap. Los buscadores deben poder acceder a esas páginas para leerla; `robots.txt` no es un control de acceso. La indicación no impide consultar el contenido público y retirar resultados ya indexados puede tardar.",
        ],
      },
      {
        heading: "7. Mensajes cifrados",
        body: [
          "Los mensajes se cifran de extremo a extremo (ECDH P-256 + AES-GCM). Ni el servidor ni quien lo administra pueden leerlos.",
          "Si se pierden los datos del navegador, los mensajes antiguos no se pueden recuperar: el servidor no tiene la clave.",
        ],
      },
      {
        heading: "8. Tus derechos",
        body: [
          "Acceso y portabilidad: «Descargar datos» en la cuenta genera un JSON con todo lo guardado.",
          "Rectificación: nombre, ciudad y biografía se cambian cuando quieras.",
          "Supresión: «Borrar cuenta» anonimiza la cuenta y elimina sesiones, avisos, listas, bloqueos, favoritos, notas personales, las claves de dispositivo publicadas y las valoraciones, también las recibidas. Los mensajes de intercambio se conservan con el autor ya anonimizado porque forman parte del historial de otras personas; las conversaciones directas se borran enteras, también para la otra persona.",
          "Oposición a los correos de aviso: en cualquier momento desde la cuenta.",
          "Reclamación: ante la autoridad de control de protección de datos competente. En Alemania, normalmente la del estado federado correspondiente; en Austria, la Datenschutzbehörde (DSB).",
          "Limitación del tratamiento: mientras se resuelve una oposición o un borrado, puedes pedir que se limite el tratamiento escribiendo a la dirección de contacto de arriba.",
          "Retirada del consentimiento: si diste tu consentimiento para algo, por ejemplo los correos de aviso, puedes retirarlo en cualquier momento sin dar motivos, desde la cuenta o por correo; la licitud del tratamiento anterior no queda afectada.",
        ],
      },
      {
        heading: "9. Copias de seguridad",
        body: [
          "Cada seis horas se hace una copia de la base de datos. Puede contener datos ya borrados: se conservan las 14 más recientes (unos tres días y medio) y la copia externa guarda 30.",
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
        body: ["Si cambia el tratamiento, se actualiza este texto."],
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
      intro: [
        "Angaben gemäß § 5 DDG.",
        "Dieses Impressum richtet sich nach den Anforderungen, die für in Deutschland niedergelassene Anbieter gelten. Die Nutzung aus Österreich ändert den Sitz des Anbieters nicht und auch nicht die rechtlichen Anforderungen, die für ihn gelten. In Österreich niedergelassene Anbieter müssen sicherstellen, dass ihr Impressum die einschlägigen österreichischen Offenlegungspflichten erfüllt, insbesondere § 5 ECG und – soweit anwendbar – § 25 MedienG.",
      ],
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
    intro: [
      "Datos identificativos del prestador del servicio conforme a la plantilla alemana.",
      "Este aviso legal se basa en los requisitos aplicables a los prestadores establecidos en Alemania. El uso del sitio web desde Austria no cambia, por sí mismo, el país de establecimiento del prestador ni los requisitos legales que le son aplicables. Los prestadores establecidos en Austria deben asegurarse de que su aviso legal cumple los requisitos austriacos de información, en particular el § 5 ECG y, cuando proceda, el § 25 MedienG.",
    ],
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
