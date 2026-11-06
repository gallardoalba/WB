/**
 * Traducción inglesa de los avisos guardados.
 *
 * Las CLAVES son el texto tal cual se guardó en la base de datos (en español):
 * no se traducen nunca, porque son las cadenas que hay que reconocer. Solo se
 * traducen los valores. Por el mismo motivo las expresiones regulares de
 * `BODY_RULES_EN` se copian literalmente de `notification-locale.ts`: se
 * ejecutan contra el texto guardado (español) y lo único que cambia es la
 * cadena de reemplazo, que mantiene los mismos `$1`, `$2` en el mismo orden.
 */

export const TITLES_EN: Record<string, string> = {
  "Alguien se ha unido a tu club": "Someone joined your club",
  "Nueva solicitud para tu club": "New request for your club",
  "Te han aceptado en el club": "You were accepted into the club",
  "Solicitud no aceptada": "Request not accepted",
  "Ya no estás en el club": "You are no longer in the club",
  "Ahora llevas un club": "You now run a club",
  "Has cedido un club": "You handed over a club",
  "Te han invitado a un club": "You were invited to a club",
  "Nuevo encuentro del club": "New club meeting",
  "Cambio de lectura en el club": "Reading changed in the club",
  "Nueva conversación en tu club": "New conversation in your club",
  "Votación de la próxima lectura": "Vote on the next reading",
  "El club avanza": "The club is making progress",
  "Mañana es el encuentro del club": "The club meeting is tomorrow",
  "Tu solicitud ha expirado": "Your request has expired",
  "Un club tuyo se ha ocultado": "One of your clubs has been hidden",
  "Tu club vuelve a estar visible": "Your club is visible again",
  "Un comentario tuyo se ha ocultado": "One of your comments has been hidden",
  "Un mensaje tuyo del foro se ha ocultado": "One of your forum posts has been hidden",
  "Tu mensaje del foro vuelve a estar visible": "Your forum post is visible again",
  "Tu comentario vuelve a estar visible": "Your comment is visible again",
  "Intercambio cancelado por moderación": "Swap cancelled by moderation",
  "Solicitud cerrada por moderación": "Request closed by moderation",
  "Tu ejemplar se ha retirado temporalmente": "Your copy has been temporarily withdrawn",
  "Tu ejemplar vuelve a estar publicado": "Your copy is published again",
  "Tu cuenta vuelve a estar activa": "Your account is active again",
  "Nueva solicitud de intercambio": "New swap request",
  "Intercambio completado": "Swap completed",
  "Confirma la entrega": "Confirm the handover",
  "Han aceptado tu solicitud": "Your request was accepted",
  "Han rechazado tu solicitud": "Your request was rejected",
  "Intercambio cancelado": "Swap cancelled",
  "Intercambio actualizado": "Swap updated",
  "Punto de entrega actualizado": "Handover point updated",
  "Nuevo mensaje en tu intercambio": "New message in your swap",
  "Nuevo mensaje directo": "New direct message",
  "Nueva valoración": "New rating",
  "Un libro que buscas ya está disponible": "A book you are looking for is now available",
  "Préstamo de club": "Club loan",
  "Préstamo de club devuelto": "Club loan returned",
  "Nueva clave de cifrado en tu cuenta": "New encryption key in your account",
  "Cambio de clave de cifrado": "Encryption key changed",
};

/** Cuerpos con partes variables: mismas expresiones que la versión alemana. */
export const BODY_RULES_EN: Array<[RegExp, string]> = [
  [/^Novedades en (.+)$/, "News in $1"],
  [/^(.+) te ha escrito\.$/, "$1 wrote to you."],
  [/^«(.+)» vuelve a estar disponible en el club\.$/, "“$1” is available in the club again."],
  [/^«(.+)» te lo presta (.+)\.$/, "“$1” is being lent to you by $2."],
  [/^Has prestado «(.+)» a (.+)\.$/, "You lent “$1” to $2."],
  [/^«(.+)» acaba de publicarse en (.+)\.$/, "“$1” was just published in $2."],
  [/^(.+) se ha unido a «(.+)»\.$/, "$1 joined “$2”."],
  [/^(.+) quiere entrar en «(.+)»\.$/, "$1 wants to join “$2”."],
  [/^Ya formas parte de «(.+)»\. La conversación está en el hilo del libro\.$/, "You are now part of “$1”. The conversation is in the book thread."],
  [/^El club «(.+)» no ha aceptado tu entrada por ahora\.$/, "The club “$1” has not accepted your request for now."],
  [/^Quien creó «(.+)» te ha retirado del club\.$/, "The person who created “$1” has removed you from the club."],
  [/^Te han cedido «(.+)»\. Ya puedes cambiar la lectura y los encuentros\.$/, "“$1” has been handed over to you. You can now change the reading and the meetings."],
  [/^«(.+)» ya tiene otra persona al frente\.$/, "“$1” now has someone else in charge."],
  [/^(.+) te invita a «(.+)»\.$/, "$1 invites you to “$2”."],
  [/^«(.+)»: (.+)$/, "“$1”: $2"],
  [/^Nadie respondió a tu solicitud de «(.+)»\.$/, "Nobody replied to your request for “$1”."],
  [/^El ejemplar «(.+)» se ha retirado mientras se revisa\.$/, "The copy “$1” has been withdrawn while it is being reviewed."],
  [/^«(.+)» queda oculto mientras el equipo revisa una denuncia\.$/, "“$1” stays hidden while the team reviews a report."],
  [/^«(.+)» se ha restablecido tras la revisión\.$/, "“$1” has been restored after the review."],
  [/^(.+) quiere leer «(.+)»\.$/, "$1 wants to read “$2”."],
  [/^«(.+)» · La otra parte ya ha confirmado\. Cuando lo recibas, confírmalo también\.$/, "“$1” · The other person has already confirmed. Confirm it too once you receive it."],
  [/^«(.+)» · Punto de entrega: (.+)$/, "“$1” · Handover point: $2"],
  [/^«(.+)»$/, "“$1”"],
  [/^(.+) te ha escrito\. Abre la conversación para leerlo\.$/, "$1 wrote to you. Open the conversation to read it."],
  [/^(.+) te ha valorado con (\d+)\/5\.$/, "$1 rated you $2/5."],
  [/^El club ha fijado otro encuentro: (.+)\.$/, "The club has scheduled another meeting: $1."],
  [/^Se ha actualizado el día de encuentro del club\.$/, "The club meeting date has been updated."],
  [/^La lectura va por el (\d+)%\.$/, "The reading is at $1%."],
  [/^«(.+)» se reúne el (.+)\.$/, "“$1” meets on $2."],
  [/^(.+) empezó a seguirte$/, "$1 started following you"],
  [/^(.+) respondió a tu comentario$/, "$1 replied to your comment"],
  [/^(.+) respondió a tu mensaje$/, "$1 replied to your message"],
  [/^«(.+)» te pide que elijas entre (\d+) libros\.$/, "“$1” asks you to choose between $2 books."],
];

export const STATIC_BODIES_EN: Record<string, string> = {
  "Lo ha retirado el equipo de moderación tras una revisión.": "The moderation team removed it after a review.",
  "Se ha restablecido tras la revisión.": "It has been restored after the review.",
  "Puedes volver a entrar y publicar ejemplares.": "You can sign in again and list copies.",
  "Verás sus novedades en la pestaña «Siguiendo» de la comunidad.": "You will see their updates in the “Following” tab of the community.",
  "El club ha elegido otra lectura en curso. Entra para verla.": "The club has chosen another reading. Open the club to see it.",
  "Se ha activado una clave distinta en otro dispositivo. Revisa que seas tú.": "A different key was activated on another device. Check that it was you.",
  "La persona con la que hablabas ha cambiado su clave. Confirma la nueva huella antes de enviar mensajes.": "The person you were talking to has changed their key. Confirm the new fingerprint before sending messages.",
};
