import type { Locale } from "./i18n";

/**
 * Los avisos se guardan como texto (no como plantilla) para que sobrevivan a
 * cambios de código. Al insertarlos se traducen al idioma de quien los recibe;
 * lo que no esté cubierto se queda en el idioma base antes que perder detalle.
 */
const TITLES: Record<string, string> = {
  "Alguien se ha unido a tu club": "Jemand ist deinem Club beigetreten",
  "Nueva solicitud para tu club": "Neue Anfrage für deinen Club",
  "Te han aceptado en el club": "Du wurdest in den Club aufgenommen",
  "Solicitud no aceptada": "Beitritt nicht angenommen",
  "Ya no estás en el club": "Du bist nicht mehr im Club",
  "Ahora llevas un club": "Du leitest jetzt einen Club",
  "Has cedido un club": "Du hast einen Club übergeben",
  "Te han invitado a un club": "Du wurdest in einen Club eingeladen",
  "Nuevo encuentro del club": "Neues Treffen des Clubs",
  "Cambio de lectura en el club": "Neue Lektüre im Club",
  "El club avanza": "Der Club kommt voran",
  "Mañana es el encuentro del club": "Morgen ist das Treffen des Clubs",
  "Tu solicitud ha expirado": "Deine Anfrage ist abgelaufen",
  "Un club tuyo se ha ocultado": "Einer deiner Clubs wurde verborgen",
  "Tu club vuelve a estar visible": "Dein Club ist wieder sichtbar",
  "Un comentario tuyo se ha ocultado": "Einer deiner Kommentare wurde verborgen",
  "Tu comentario vuelve a estar visible": "Dein Kommentar ist wieder sichtbar",
  "Intercambio cancelado por moderación": "Tausch von der Moderation storniert",
  "Solicitud cerrada por moderación": "Anfrage von der Moderation geschlossen",
  "Tu ejemplar se ha retirado temporalmente": "Dein Exemplar wurde vorübergehend zurückgezogen",
  "Tu ejemplar vuelve a estar publicado": "Dein Exemplar ist wieder veröffentlicht",
  "Tu cuenta vuelve a estar activa": "Dein Konto ist wieder aktiv",
  "Nueva solicitud de intercambio": "Neue Tauschanfrage",
  "Intercambio completado": "Tausch abgeschlossen",
  "Confirma la entrega": "Bestätige die Übergabe",
  "Han aceptado tu solicitud": "Deine Anfrage wurde angenommen",
  "Han rechazado tu solicitud": "Deine Anfrage wurde abgelehnt",
  "Intercambio cancelado": "Tausch storniert",
  "Intercambio actualizado": "Tausch aktualisiert",
  "Punto de entrega actualizado": "Übergabeort aktualisiert",
  "Nuevo mensaje en tu intercambio": "Neue Nachricht in deinem Tausch",
  "Nueva valoración": "Neue Bewertung",
  "Un libro que buscas ya está disponible": "Ein gesuchtes Buch ist jetzt verfügbar",
  "Préstamo de club": "Club-Ausleihe",
  "Préstamo de club devuelto": "Club-Ausleihe zurückgegeben",
  "Nueva clave de cifrado en tu cuenta": "Neuer Verschlüsselungsschlüssel in deinem Konto",
  "Cambio de clave de cifrado": "Verschlüsselungsschlüssel geändert",
};

/** Cuerpos con partes variables: se traducen conservando los datos. */
const BODY_RULES: Array<[RegExp, string]> = [
  [/^Novedades en (.+)$/, "Neuigkeiten in $1"],
  [/^«(.+)» vuelve a estar disponible en el club\.$/, "„$1“ ist im Club wieder verfügbar."],
  [/^«(.+)» te lo presta (.+)\.$/, "„$1“ wird dir von $2 geliehen."],
  [/^Has prestado «(.+)» a (.+)\.$/, "Du hast „$1“ an $2 verliehen."],
  [/^«(.+)» acaba de publicarse en (.+)\.$/, "„$1“ wurde gerade in $2 veröffentlicht."],
  [/^(.+) se ha unido a «(.+)»\.$/, "$1 ist „$2“ beigetreten."],
  [/^(.+) quiere entrar en «(.+)»\.$/, "$1 möchte „$2“ beitreten."],
  [/^Ya formas parte de «(.+)»\. La conversación está en el hilo del libro\.$/, "Du bist jetzt Teil von „$1“. Das Gespräch läuft im Buchthread."],
  [/^El club «(.+)» no ha aceptado tu entrada por ahora\.$/, "Der Club „$1“ hat deinen Beitritt vorerst nicht angenommen."],
  [/^Quien creó «(.+)» te ha retirado del club\.$/, "Die Gründerin oder der Gründer hat dich aus „$1“ entfernt."],
  [/^Te han cedido «(.+)»\. Ya puedes cambiar la lectura y los encuentros\.$/, "„$1“ wurde dir übergeben. Du kannst jetzt Lektüre und Treffen ändern."],
  [/^«(.+)» ya tiene otra persona al frente\.$/, "„$1“ hat jetzt eine andere Leitung."],
  [/^(.+) te invita a «(.+)»\.$/, "$1 lädt dich zu „$2“ ein."],
  [/^«(.+)»: (.+)$/, "„$1“: $2"],
  [/^Nadie respondió a tu solicitud de «(.+)»\.$/, "Niemand hat auf deine Anfrage zu „$1“ geantwortet."],
  [/^El ejemplar «(.+)» se ha retirado mientras se revisa\.$/, "Das Exemplar „$1“ wurde während der Prüfung zurückgezogen."],
  [/^«(.+)» queda oculto mientras el equipo revisa una denuncia\.$/, "„$1“ bleibt verborgen, während das Team eine Meldung prüft."],
  [/^«(.+)» se ha restablecido tras la revisión\.$/, "„$1“ wurde nach der Prüfung wiederhergestellt."],
  [/^(.+) quiere leer «(.+)»\.$/, "$1 möchte „$2“ lesen."],
  [/^«(.+)» · La otra parte ya ha confirmado\. Cuando lo recibas, confírmalo también\.$/, "„$1“ · Die andere Seite hat bereits bestätigt. Bestätige die Übergabe, sobald du das Buch hast."],
  [/^«(.+)» · Punto de entrega: (.+)$/, "„$1“ · Übergabeort: $2"],
  [/^«(.+)»$/, "„$1“"],
  [/^(.+) te ha escrito\. Abre la conversación para leerlo\.$/, "$1 hat dir geschrieben. Öffne die Unterhaltung, um es zu lesen."],
  [/^(.+) te ha valorado con (\d+)\/5\.$/, "$1 hat dich mit $2/5 bewertet."],
  [/^El club ha fijado otro encuentro: (.+)\.$/, "Der Club hat ein neues Treffen festgelegt: $1."],
  [/^Se ha actualizado el día de encuentro del club\.$/, "Der Treffpunkt des Clubs wurde aktualisiert."],
  [/^La lectura va por el (\d+)%\.$/, "Die Lektüre ist bei $1 %."],
  [/^«(.+)» se reúne el (.+)\.$/, "„$1“ trifft sich am $2."],
  [/^(.+) empezó a seguirte$/, "$1 folgt dir jetzt"],
  [/^(.+) respondió a tu comentario$/, "$1 hat auf deinen Kommentar geantwortet"],
];

const STATIC_BODIES: Record<string, string> = {
  "Lo ha retirado el equipo de moderación tras una revisión.": "Das Moderationsteam hat es nach einer Prüfung entfernt.",
  "Se ha restablecido tras la revisión.": "Es wurde nach der Prüfung wiederhergestellt.",
  "Puedes volver a entrar y publicar ejemplares.": "Du kannst dich wieder anmelden und Exemplare einstellen.",
  "Verás sus novedades en la pestaña «Siguiendo» de la comunidad.": "Ihre Neuigkeiten erscheinen im Tab „Folgt“ der Gemeinschaft.",
  "El club ha elegido otra lectura en curso. Entra para verla.": "Der Club hat eine andere Lektüre gewählt. Öffne den Club, um sie zu sehen.",
  "Se ha activado una clave distinta en otro dispositivo. Revisa que seas tú.": "Auf einem anderen Gerät wurde ein anderer Schlüssel aktiviert. Prüfe, ob du das warst.",
  "La persona con la que hablabas ha cambiado su clave. Confirma la nueva huella antes de enviar mensajes.": "Die Person, mit der du geschrieben hast, hat ihren Schlüssel geändert. Bestätige den neuen Fingerabdruck, bevor du Nachrichten sendest.",
};

function translateTitle(title: string): string {
  if (TITLES[title]) return TITLES[title];
  for (const [rule, replacement] of BODY_RULES) {
    if (rule.test(title)) return title.replace(rule, replacement);
  }
  return title;
}

function translateBody(body: string): string {
  if (!body) return body;
  if (STATIC_BODIES[body]) return STATIC_BODIES[body];
  for (const [rule, replacement] of BODY_RULES) {
    if (rule.test(body)) return body.replace(rule, replacement);
  }
  return body;
}

export function localizeNotification(
  locale: Locale,
  title: string,
  body: string,
): { title: string; body: string } {
  if (locale !== "de") return { title, body };
  return { title: translateTitle(title), body: translateBody(body) };
}
