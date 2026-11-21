/**
 * «Über das Projekt» (`/projekt`).
 *
 * Es la página que abre quien quiere saber qué hay detrás del sitio: qué es,
 * por qué existe, qué demuestra técnicamente y cómo se puede contactar. Igual
 * que `legal.ts` y `technical.ts`, el texto se compone por idioma y no pasa por
 * el diccionario: son párrafos largos, no textos de interfaz.
 *
 * Reutiliza el mismo formato que la documentación (`TechnicalDocument`) para no
 * duplicar el renderizador ni los estilos.
 */
import { REPOSITORY, ISSUES } from "./brand";
import { maskContact } from "./legal";
import type { Locale } from "./i18n";
import type { TechnicalDocument } from "./technical";

const UPDATED = "2026-11-18";

const ES = (contact: string): TechnicalDocument => ({
  title: "El proyecto",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek es un proyecto comunitario y sin ánimo de lucro: un lugar donde compartir los libros que más nos han marcado, para que vuelvan a circular y el conocimiento crezca entre todas.",
    "Esta página cuenta qué es, por qué existe y qué decisiones hay detrás de cómo está hecho.",
  ],
  sections: [
    {
      id: "que-es",
      heading: "Qué es",
      blocks: [
        {
          kind: "p",
          text: "Una plataforma para compartir e intercambiar libros impresos: se publica un ejemplar con su estado y la ciudad donde está, se busca por título, autoría o tema, y la entrega se acuerda entre las dos personas.",
        },
      ],
    },
    {
      id: "por-que",
      heading: "Por qué existe",
      blocks: [
        {
          kind: "p",
          text: "Hay libros que conservamos por la huella que dejaron en nosotros. Ponerlos a circular es tratar el conocimiento como un bien común que crece al compartirse, no como una propiedad que cada cual guarda. Un libro que circula produce más que uno guardado: lecturas, conversaciones y también desacuerdos. Por eso la plataforma está pensada para los títulos que importan, no para un inventario.",
        },
        {
          kind: "p",
          text: "No se vende nada: los ejemplares se regalan o se cambian, sin precio ni compensación. No hay moneda interna, ni puntos por actividad, ni clasificaciones que premien a quien más publica: lo que se espera es reciprocidad, no un saldo.",
        },
      ],
    },
    {
      id: "sin-animo-de-lucro",
      heading: "Sin ánimo de lucro y sin mercado",
      blocks: [
        {
          kind: "p",
          text: "El proyecto no cobra, no muestra publicidad y no vende datos. Tampoco hay cuenta premium ni espacios de pago: lo que la plataforma ofrece está disponible para cualquier cuenta.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Reciprocidad",
              text: "compartir no implica esperar algo a cambio. Cualquiera puede pedir cualquier libro y quien lo tiene decide libremente si regalarlo o intercambiarlo. No hay equivalencias ni deudas individuales: cada aportación contribuye a que los libros sigan circulando y el conocimiento llegue a más personas.",
            },
            {
              label: "Libros como bienes comunes",
              text: "un libro ya leído no es un objeto que se guarda, es algo que puede seguir circulando. La plataforma gestiona entregas, no propiedades: regalar un ejemplar no lo pierde, lo pone en circulación.",
            },
            {
              label: "Autoorganización",
              text: "las comunidades y los círculos de lectura deciden autónomamente qué leer, cuándo reunirse y cómo organizarse, sin una dirección central.",
            },
          ],
        },
        {
          kind: "p",
          text: "Ninguna de estas decisiones es neutral. La plataforma está hecha para que el conocimiento circule como bien común y para que quienes la usan decidan por sí mismas, no para extraer valor de ellas.",
        },
      ],
    },
    {
      id: "codigo-abierto",
      heading: "Código abierto y biblioteca descentralizada",
      blocks: [
        {
          kind: "p",
          text: "El código está publicado con licencia AGPL-3.0: cualquiera puede leerlo, auditarlo, modificarlo o montar su propia copia del servicio. No es solo que sea gratis; al estar a la vista, lo que la plataforma hace se puede comprobar en el código y en la documentación técnica. Esta instancia ejecuta exactamente ese código, sin añadidos.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Código en GitHub",
              href: REPOSITORY,
              note: "Historial público y guía de despliegue.",
            },
            {
              label: "Documentación técnica",
              href: "/techdoc",
              note: "Arquitectura, datos, seguridad y operación.",
            },
            {
              label: "Normas y gobernanza",
              href: "/normas",
              note: "Moderación, sanciones y apelaciones.",
            },
          ],
        },
      ],
    },
    {
      id: "como-esta-hecho",
      heading: "Cómo está hecho",
      blocks: [
        {
          kind: "p",
          text: "La parte visible es solo una parte. Lo que define la plataforma es lo que no hace con los datos de nadie: no pide más de lo necesario, no los comparte con terceros y no los usa para retener a quien entra.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Privacidad por defecto",
              text: "el registro pide nombre, ciudad y correo, y la contraseña se guarda solo como hash; la biografía es opcional. No hay analítica de terceros ni píxeles de seguimiento: los contadores propios se quedan en la base de datos y se conservan 180 días. Todos los datos propios se pueden exportar en JSON y la cuenta se puede borrar por completo.",
            },
            {
              label: "El catálogo público no lleva nombres",
              text: "las fichas de obra que se indexan en los buscadores solo llevan el libro y cifras por ciudad; quién ofrece el ejemplar no aparece.",
            },
            {
              label: "Mensajería cifrada de extremo a extremo",
              text: "la clave privada vive en el navegador y el servidor solo transporta sobres opacos. Lo delicado de la cuenta, como el segundo factor, se guarda cifrado con una clave que no está en la base de datos.",
            },
            {
              label: "Catalogación cuidada",
              text: "las fichas se rellenan con datos de la DNB (MARC21) y Open Library, incluida la clasificación; las consultas salen del servidor y se guardan en disco, así que el navegador no habla con esos servicios.",
            },
            {
              label: "Accesibilidad",
              text: "contraste suficiente, foco visible, áreas táctiles amplias, navegación con teclado y etiquetas para lectores de pantalla, también cuando se pide menos movimiento.",
            },
            {
              label: "Alemán, castellano e inglés",
              text: "la interfaz completa en los tres idiomas, con el contenido largo compuesto por idioma.",
            },
            {
              label: "Copias de seguridad y continuidad",
              text: "copias de seguridad cifradas cada seis horas y una restauración ensayada: el servicio se puede reconstruir desde cero con la copia de seguridad y el código.",
            },
          ],
        },
      ],
    },
    {
      id: "contacto",
      heading: "Contacto",
      blocks: [
        {
          kind: "p",
          text: `Para sugerencias, avisos de moderación o para montar una instancia propia: ${maskContact(contact) || "abre una incidencia en el repositorio"}.`,
        },
        {
          kind: "links",
          items: [
            { label: "Issues", href: ISSUES, note: "Incidencias y propuestas." },
            { label: "Privacidad", href: "/datenschutz", note: "Qué datos se tratan y durante cuánto tiempo." },
            { label: "Aviso legal", href: "/aviso-legal", note: "Quién responde de esta instancia." },
          ],
        },
      ],
    },
  ],
});

const DE = (contact: string): TechnicalDocument => ({
  title: "Über das Projekt",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek ist ein Gemeinschaftsprojekt ohne kommerziellen Zweck: ein Ort, um die Bücher zu teilen, die uns am meisten geprägt haben, damit sie wieder zirkulieren und Wissen zwischen allen wächst.",
    "Diese Seite erklärt, was das Projekt ist, warum es existiert und welche Entscheidungen hinter der Umsetzung stehen.",
  ],
  sections: [
    {
      id: "was-es-ist",
      heading: "Was es ist",
      blocks: [
        {
          kind: "p",
          text: "Eine Plattform zum Teilen und Tauschen gedruckter Bücher: Man stellt ein Exemplar mit Zustand und Stadt ein, sucht nach Titel, Autor:in oder Thema und verabredet die Übergabe zu zweit.",
        },
      ],
    },
    {
      id: "warum",
      heading: "Warum es das gibt",
      blocks: [
        {
          kind: "p",
          text: "Manche Bücher bewahren wir wegen der Spuren, die sie in uns hinterlassen haben. Sie weiterzugeben heißt, Wissen als ein Gemeingut zu behandeln, das wächst, wenn es geteilt wird, und nicht als Besitz, den jede und jeder für sich behält. Ein Buch, das zirkuliert, bringt mehr als eines, das im Regal bleibt: Lektüren, Gespräche und auch Widerspruch. Deshalb ist die Plattform für Titel gedacht, die etwas bedeuten, nicht für einen Bestand.",
        },
        {
          kind: "p",
          text: "Hier wird nichts verkauft: Exemplare werden verschenkt oder getauscht, ohne Preis und ohne Gegenleistung. Es gibt keine interne Währung, keine Punkte für Aktivität und keine Ranglisten, die belohnen, wer am meisten einstellt: Erwartet wird Gegenseitigkeit, kein Guthaben.",
        },
      ],
    },
    {
      id: "gemeinnuetzig",
      heading: "Gemeinnützig und ohne Markt",
      blocks: [
        {
          kind: "p",
          text: "Das Projekt kostet nichts, zeigt keine Werbung und verkauft keine Daten. Es gibt auch kein Premium-Konto und keine bezahlten Plätze: Was die Plattform bietet, steht jedem Konto zur Verfügung.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Gegenseitigkeit",
              text: "teilen heißt nicht, etwas dafür zu erwarten. Jede Person kann jedes Buch anfragen, und wer es hat, entscheidet frei, ob sie es verschenkt oder tauscht. Es gibt keine Gegenrechnung und keine Schulden zwischen Einzelnen: Jeder Beitrag hilft, dass die Bücher weiter zirkulieren und das Wissen mehr Menschen erreicht.",
            },
            {
              label: "Bücher als Gemeingut",
              text: "ein gelesenes Buch ist kein ruhender Bestand, sondern etwas, das weiter zirkulieren kann. Die Plattform verwaltet Übergaben, nicht Eigentum: Ein Exemplar wegzugeben heißt nicht, es zu verlieren; es kommt in Umlauf.",
            },
            {
              label: "Selbstorganisation",
              text: "Gemeinschaften und Lesekreise entscheiden selbstständig, was sie lesen, wann sie sich treffen und wie sie sich organisieren – ohne eine zentrale Leitung.",
            },
          ],
        },
        {
          kind: "p",
          text: "Keine dieser Entscheidungen ist neutral. Die Plattform ist dafür gebaut, dass Wissen als Gemeingut zirkuliert und dass die Menschen, die sie nutzen, selbst entscheiden – nicht dafür, aus ihnen Wert zu ziehen.",
        },
      ],
    },
    {
      id: "quelloffen",
      heading: "Quelloffener Code, dezentrale Bibliothek",
      blocks: [
        {
          kind: "p",
          text: "Der Code ist unter der AGPL-3.0-Lizenz veröffentlicht: Jede und jeder kann ihn lesen, prüfen, verändern oder den Dienst selbst betreiben. Er ist nicht nur kostenlos; weil er offenliegt, lässt sich nachprüfen, was die Plattform tut – im Code und in der technischen Dokumentation. Die Instanz, die diese Seite ausliefert, führt genau diesen Code aus, ohne Zusätze.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Code auf GitHub",
              href: REPOSITORY,
              note: "Öffentliche Historie und Anleitung zum Betrieb.",
            },
            {
              label: "Technische Dokumentation",
              href: "/techdoc",
              note: "Architektur, Daten, Sicherheit und Betrieb.",
            },
            {
              label: "Regeln und Governance",
              href: "/normas",
              note: "Moderation, Sanktionen und Einsprüche.",
            },
          ],
        },
      ],
    },
    {
      id: "wie-es-gebaut-ist",
      heading: "Wie es gebaut ist",
      blocks: [
        {
          kind: "p",
          text: "Das Sichtbare ist der kleinere Teil. Was die Plattform ausmacht, ist das, was sie mit den Daten anderer nicht tut: Sie verlangt nicht mehr als nötig, gibt sie nicht an Dritte weiter und nutzt sie nicht, um jemanden zu halten.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Datenschutz als Voreinstellung",
              text: "die Registrierung verlangt Name, Stadt und E-Mail-Adresse, das Passwort wird nur als Hash gespeichert; die Biografie ist freiwillig. Es gibt keine Analyse von Dritten und keine Tracking-Pixel: eigene Zähler bleiben in der Datenbank und verfallen nach 180 Tagen. Alles Eigene lässt sich als JSON exportieren, und das Konto lässt sich vollständig löschen.",
            },
            {
              label: "Der öffentliche Katalog trägt keine Namen",
              text: "indexiert werden nur Werke mit Buchdaten und Zahlen je Stadt; wer das Exemplar anbietet, erscheint nicht.",
            },
            {
              label: "Ende-zu-Ende-verschlüsselte Nachrichten",
              text: "der private Schlüssel bleibt im Browser, der Server befördert nur undurchsichtige Umschläge. Vertrauliche Angaben zum Konto – etwa der zweite Faktor – werden mit einem Schlüssel verschlüsselt, der nicht in der Datenbank liegt.",
            },
            {
              label: "Sorgfältige Titelaufnahme",
              text: "die Daten kommen aus der DNB (MARC21) und Open Library, einschließlich der Klassifikation; die Abfragen gehen vom Server aus und werden auf der Platte zwischengespeichert, der Browser spricht nicht mit ihnen.",
            },
            {
              label: "Barrierefreiheit",
              text: "ausreichender Kontrast, sichtbarer Fokus, großzügig bemessene Berührungsflächen, Bedienung per Tastatur und Beschriftungen für Screenreader, auch wenn weniger Bewegung gewünscht ist.",
            },
            {
              label: "Deutsch, Spanisch und Englisch",
              text: "die Oberfläche vollständig in den drei Sprachen, lange Texte je Sprache verfasst.",
            },
            {
              label: "Datensicherung und Fortbestand",
              text: "verschlüsselte Datensicherungen alle sechs Stunden und eine geübte Wiederherstellung: Der Dienst lässt sich aus Datensicherung und Code von Grund auf neu aufsetzen.",
            },
          ],
        },
      ],
    },
    {
      id: "kontakt",
      heading: "Kontakt",
      blocks: [
        {
          kind: "p",
          text: `Für Hinweise, Moderationsmeldungen oder eine eigene Instanz: ${maskContact(contact) || "ein Issue im Repository eröffnen"}.`,
        },
        {
          kind: "links",
          items: [
            { label: "Issues", href: ISSUES, note: "Issues und Vorschläge." },
            { label: "Datenschutz", href: "/datenschutz", note: "Welche Daten wie lange verarbeitet werden." },
            { label: "Impressum", href: "/aviso-legal", note: "Wer für diese Instanz verantwortlich ist." },
          ],
        },
      ],
    },
  ],
});

const EN = (contact: string): TechnicalDocument => ({
  title: "The project",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek is a community project with no commercial purpose: a place to share the books that have shaped us most, so they can circulate again and knowledge can grow between all of us.",
    "This page explains what it is, why it exists and which decisions stand behind how it is built.",
  ],
  sections: [
    {
      id: "what-it-is",
      heading: "What it is",
      blocks: [
        {
          kind: "p",
          text: "A platform for sharing and swapping printed books: you list a copy with its condition and city, search by title, author or subject, and the two of you agree the hand-over.",
        },
      ],
    },
    {
      id: "why",
      heading: "Why it exists",
      blocks: [
        {
          kind: "p",
          text: "Some books we keep for the mark they left on us. Passing them on is a way of treating knowledge as a commons that grows when shared, rather than as property each of us keeps. A book in circulation does more than one left on a shelf: it produces readings, conversations and disagreement. That is why the platform is meant for titles that matter, not for stock.",
        },
        {
          kind: "p",
          text: "Nothing is sold here: copies are given away or swapped, with no price and no payment. There is no internal currency, no points for activity and no rankings that reward those who post the most: what is expected is reciprocity, not a balance.",
        },
      ],
    },
    {
      id: "non-profit",
      heading: "Non-profit and no market",
      blocks: [
        {
          kind: "p",
          text: "The project costs nothing, shows no advertising and sells no data. There is no premium tier and no paid placement either: everything the platform offers is available to every account.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Reciprocity",
              text: "sharing does not mean expecting something in return. Anyone can ask for any book and whoever has it decides freely whether to give it away or swap it. There are no equivalents and no individual debts: every contribution helps keep books in circulation and knowledge reaching more people.",
            },
            {
              label: "Books as commons",
              text: "a book that has been read is not idle stock; it can keep circulating. The platform manages hand-overs, not property: giving a copy away does not mean losing it; it puts it into circulation.",
            },
            {
              label: "Self-organisation",
              text: "communities and reading circles decide for themselves what to read, when to meet and how to organise, with no central management.",
            },
          ],
        },
        {
          kind: "p",
          text: "None of these decisions is neutral. The platform is built so that knowledge circulates as a commons and so that the people who use it decide for themselves, not so that value is extracted from them.",
        },
      ],
    },
    {
      id: "open-source",
      heading: "Open source and a decentralised library",
      blocks: [
        {
          kind: "p",
          text: "The code is published under the AGPL-3.0 licence: anyone can read it, audit it, change it or run the service themselves. It is not only free of charge; because it is open, what the platform does can be checked in the code and in the technical documentation. The instance serving this page runs exactly that code, with nothing added.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Code on GitHub",
              href: REPOSITORY,
              note: "Public history and deployment guide.",
            },
            {
              label: "Technical documentation",
              href: "/techdoc",
              note: "Architecture, data, security and operation.",
            },
            {
              label: "Rules and governance",
              href: "/normas",
              note: "Moderation, sanctions and appeals.",
            },
          ],
        },
      ],
    },
    {
      id: "how-it-is-built",
      heading: "How it is built",
      blocks: [
        {
          kind: "p",
          text: "The visible part is the smaller half. What defines the platform is what it does not do with other people's data: it asks for no more than it needs, hands none of it to third parties and uses none of it to keep anyone tied to it.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Privacy by default",
              text: "signing up asks for a name, a city and an email address, and the password is stored only as a hash; the biography is optional. There is no third-party analytics and no tracking pixels: the project's own counters stay in the database and expire after 180 days. All your own data can be exported as JSON, and the account can be deleted entirely.",
            },
            {
              label: "The public catalogue carries no names",
              text: "only works, with book data and figures per city, are indexed; who offers the copy does not appear.",
            },
            {
              label: "End-to-end encrypted messaging",
              text: "the private key stays in the browser, and the server only relays opaque envelopes. Account secrets such as the second factor are stored encrypted with a key that is not in the database.",
            },
            {
              label: "Careful cataloguing",
              text: "records come from the DNB (MARC21) and Open Library, including the classification; the lookups are made by the server and cached on disk, so the browser never talks to them.",
            },
            {
              label: "Accessibility",
              text: "sufficient contrast, visible focus, generous touch targets, keyboard operation and screen-reader labels, including when less motion is asked for.",
            },
            {
              label: "German, Spanish and English",
              text: "the whole interface in the three languages, with long-form text written per language.",
            },
            {
              label: "Backups and continuity",
              text: "encrypted backups every six hours and a rehearsed restore: the service can be rebuilt from scratch with the backup and the code.",
            },
          ],
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "p",
          text: `For suggestions, moderation reports or to run your own instance: ${maskContact(contact) || "open an issue in the repository"}.`,
        },
        {
          kind: "links",
          items: [
            { label: "Issues", href: ISSUES, note: "Issues and proposals." },
            { label: "Privacy", href: "/datenschutz", note: "Which data is processed and for how long." },
            { label: "Legal notice", href: "/aviso-legal", note: "Who is responsible for this instance." },
          ],
        },
      ],
    },
  ],
});

/** Texto de la página del proyecto en el idioma activo. */
export function projectDocument(locale: Locale, contact: string): TechnicalDocument {
  if (locale === "de") return DE(contact);
  if (locale === "en") return EN(contact);
  return ES(contact);
}
