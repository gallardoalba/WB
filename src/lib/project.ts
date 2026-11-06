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
import { REPOSITORY } from "./brand";
import type { Locale } from "./i18n";
import type { TechnicalDocument } from "./technical";

const UPDATED = "2026-11-06";

const ES = (contact: string): TechnicalDocument => ({
  title: "El proyecto",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek es un proyecto comunitario y sin ánimo de lucro: los libros que ya se han leído vuelven a circular en lugar de quedarse en una estantería.",
    "Esta página cuenta qué es, por qué existe y qué hay detrás de cómo está hecho.",
  ],
  sections: [
    {
      id: "que-es",
      heading: "Qué es",
      blocks: [
        {
          kind: "p",
          text: "Una plataforma para compartir e intercambiar libros impresos entre lectores de toda Alemania. Cada ejemplar tiene su ficha, cada persona puede pedir el que le interesa y la entrega se acuerda entre las dos partes, en mano o por correo.",
        },
        {
          kind: "list",
          items: [
            "Publicar un ejemplar con su ISBN: el título, la autoría, el sello y la colección se rellenan solos.",
            "Buscar por título, autoría, ciudad o tema y pedir el libro que falta.",
            "Acordar la entrega, confirmarla entre las dos partes y dejar que el libro siga viajando.",
          ],
        },
      ],
    },
    {
      id: "por-que",
      heading: "Por qué existe",
      blocks: [
        {
          kind: "p",
          text: "En casi todas las casas hay una caja de libros que ya nadie va a releer. Venderlos de uno en uno da pereza y tirarlos es un desperdicio. Lo que faltaba no era un sitio donde anunciarlos, sino saber con quién: alguien cerca que busca justo ese título.",
        },
        {
          kind: "p",
          text: "No se vende nada. Se presta, se cambia y se regala. Una plataforma para la comunidad no necesita comisiones para funcionar.",
        },
      ],
    },
    {
      id: "sin-animo-de-lucro",
      heading: "Sin ánimo de lucro y código abierto",
      blocks: [
        {
          kind: "p",
          text: "El proyecto no cobra, no muestra publicidad y no vende datos. El código está publicado y cualquiera puede leerlo, auditarlo o montar su propia instancia: la que sirve esta página describe el código que ejecuta.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Código en GitHub",
              href: REPOSITORY,
              note: "Licencia MIT, historial público y guía de despliegue.",
            },
            {
              label: "Documentación técnica",
              href: "/documentacion",
              note: "Arquitectura, datos, seguridad y operación.",
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
          text: "La parte visible es lo de menos; las decisiones que importan están en lo que el sitio no hace con los datos de nadie.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Privacidad por defecto",
              text: "se guarda el nombre, la ciudad y el correo, nada más. El catálogo no se publica a los buscadores con nombres; las fichas de obra que sí se indexan solo llevan el libro y cifras.",
            },
            {
              label: "Mensajería cifrada de extremo a extremo",
              text: "la clave privada vive en el navegador y el servidor solo transporta sobres opacos. Los datos de envío se guardan cifrados con la clave de la instancia.",
            },
            {
              label: "Catalogación cuidada",
              text: "las fichas se rellenan con la DNB (MARC21) y Open Library, con sello, año, colección y clasificación.",
            },
            {
              label: "Accesibilidad",
              text: "contraste suficiente, foco visible, objetivos táctiles de 44 px, navegación con teclado y etiquetas para lectores de pantalla.",
            },
            {
              label: "Alemán y castellano",
              text: "la interfaz completa en los dos idiomas, con el contenido largo compuesto por idioma.",
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
          text: `Para sugerencias, avisos de moderación o para montar una instancia propia: ${contact || "abre una incidencia en el repositorio"}.`,
        },
        {
          kind: "links",
          items: [
            { label: "Repositorio", href: REPOSITORY, note: "Incidencias y propuestas." },
            { label: "Privacidad", href: "/privacidad", note: "Qué datos se tratan y durante cuánto tiempo." },
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
    "Wanderbibliothek ist ein Gemeinschaftsprojekt ohne kommerziellen Zweck: Gelesene Bücher sollen weiterreisen, statt im Regal zu verstauben.",
    "Diese Seite erklärt, was das Projekt ist, warum es existiert und was hinter der Umsetzung steckt.",
  ],
  sections: [
    {
      id: "was-es-ist",
      heading: "Was es ist",
      blocks: [
        {
          kind: "p",
          text: "Eine Plattform zum Teilen und Tauschen gedruckter Bücher zwischen Leser:innen in ganz Deutschland. Jedes Exemplar hat seinen Eintrag, jede Person kann das Buch anfragen, das ihr fehlt, und die Übergabe verabreden beide Seiten — persönlich oder per Post.",
        },
        {
          kind: "list",
          items: [
            "Ein Exemplar mit ISBN einstellen: Titel, Autor:in, Verlag und Reihe werden automatisch ergänzt.",
            "Nach Titel, Autor:in, Stadt oder Thema suchen und das fehlende Buch anfragen.",
            "Die Übergabe verabreden, von beiden Seiten bestätigen und das Buch weiterziehen lassen.",
          ],
        },
      ],
    },
    {
      id: "warum",
      heading: "Warum es das gibt",
      blocks: [
        {
          kind: "p",
          text: "In fast jedem Haushalt steht eine Kiste Bücher, die niemand mehr liest. Einzeln verkaufen ist mühsam, wegwerfen ist Verschwendung. Was fehlte, war nicht eine Anzeigenseite, sondern die Antwort auf die Frage: Wer in der Nähe sucht genau diesen Titel?",
        },
        {
          kind: "p",
          text: "Hier wird nichts verkauft. Es wird verliehen, getauscht und verschenkt. Eine Plattform für die Gemeinschaft braucht keine Provision, um zu funktionieren.",
        },
      ],
    },
    {
      id: "gemeinnuetzig",
      heading: "Gemeinnützig und quelloffen",
      blocks: [
        {
          kind: "p",
          text: "Das Projekt kostet nichts, zeigt keine Werbung und verkauft keine Daten. Der Code ist veröffentlicht: Jede und jeder kann ihn lesen, prüfen oder eine eigene Instanz betreiben. Die Instanz, die diese Seite ausliefert, beschreibt genau den Code, den sie ausführt.",
        },
        {
          kind: "links",
          items: [
            {
              label: "Code auf GitHub",
              href: REPOSITORY,
              note: "MIT-Lizenz, öffentliche Historie und Anleitung zum Betrieb.",
            },
            {
              label: "Technische Dokumentation",
              href: "/documentacion",
              note: "Architektur, Daten, Sicherheit und Betrieb.",
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
          text: "Das Sichtbare ist der kleinere Teil. Entscheidend ist, was der Dienst mit den Daten anderer nicht tut.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Datenschutz als Voreinstellung",
              text: "gespeichert werden Name, Stadt und E-Mail-Adresse, sonst nichts. Der Katalog wird nicht mit Namen an Suchmaschinen ausgeliefert; indexiert werden nur Werke mit Buchdaten und Zahlen.",
            },
            {
              label: "Ende-zu-Ende-verschlüsselte Nachrichten",
              text: "der private Schlüssel bleibt im Browser, der Server befördert nur undurchsichtige Umschläge. Versanddaten werden mit dem Schlüssel der Instanz verschlüsselt gespeichert.",
            },
            {
              label: "Sorgfältige Titelaufnahme",
              text: "die Daten kommen aus der DNB (MARC21) und Open Library — mit Verlag, Jahr, Reihe und Klassifikation.",
            },
            {
              label: "Barrierefreiheit",
              text: "ausreichender Kontrast, sichtbarer Fokus, 44-px-Ziele für Finger, Bedienung per Tastatur und Beschriftungen für Screenreader.",
            },
            {
              label: "Deutsch und Spanisch",
              text: "die Oberfläche vollständig in beiden Sprachen, lange Texte je Sprache verfasst.",
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
          text: `Für Hinweise, Moderationsmeldungen oder eine eigene Instanz: ${contact || "ein Issue im Repository eröffnen"}.`,
        },
        {
          kind: "links",
          items: [
            { label: "Repository", href: REPOSITORY, note: "Issues und Vorschläge." },
            { label: "Datenschutz", href: "/privacidad", note: "Welche Daten wie lange verarbeitet werden." },
            { label: "Impressum", href: "/aviso-legal", note: "Wer für diese Instanz verantwortlich ist." },
          ],
        },
      ],
    },
  ],
});

/** Texto de la página del proyecto en el idioma activo. */
export function projectDocument(locale: Locale, contact: string): TechnicalDocument {
  return locale === "de" ? DE(contact) : ES(contact);
}
