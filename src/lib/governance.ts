import type { Locale } from "./locale";
import type { TechnicalDocument } from "./technical";

const UPDATED = "2026-11-15";

const ES: TechnicalDocument = {
  title: "Gobernanza",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek es software libre y cada instancia la gobierna su comunidad. Este documento separa lo que garantiza el proyecto de lo que decide cada instancia.",
    "También explica cómo se modera, cómo se sanciona y cómo se puede recurrir una sanción.",
  ],
  sections: [
    {
      id: "proyecto-e-instancia",
      heading: "Proyecto e instancia",
      blocks: [
        {
          kind: "p",
          text: "El proyecto publica el código con licencia MIT, mantiene la documentación y publica versiones. Cada instancia decide sus normas, a quién admite y cómo organiza su moderación: el proyecto no gobierna las instancias.",
        },
      ],
    },
    {
      id: "quien-hace-que",
      heading: "Quién hace qué",
      blocks: [
        {
          kind: "terms",
          items: [
            {
              label: "Mantenimiento del proyecto",
              text: "revisa el código, publica versiones y cuida la documentación técnica. No administra las instancias.",
            },
            {
              label: "Administración de la instancia",
              text: "gestiona el servidor, las copias y el alta del equipo, y es la única que puede suspender cuentas.",
            },
            {
              label: "Moderación",
              text: "revisa denuncias, oculta contenido y documenta sus actuaciones. No suspende cuentas ni nombra al equipo.",
            },
            {
              label: "Comunidad",
              text: "participa en clubes y listas, propone cambios y puede pedir la revisión de cualquier decisión que le afecte.",
            },
          ],
        },
      ],
    },
    {
      id: "moderacion",
      heading: "Cómo se modera",
      blocks: [
        {
          kind: "p",
          text: "Se modera para proteger a las personas, no para castigar la incomodidad o el desacuerdo. Una crítica, una reseña dura o una conversación incómoda no son, por sí mismas, motivos de sanción.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Proporcionalidad",
              text: "se aplica la medida menos restrictiva que resuelve el problema: ocultar un contenido antes que suspender una cuenta.",
            },
            {
              label: "Motivo",
              text: "toda sanción explica qué norma se ha incumplido y qué conducta la motiva. La persona afectada lo recibe por correo.",
            },
            {
              label: "Plazo",
              text: "las suspensiones tienen una duración concreta, de un día a un año, y se levantan solas al vencer.",
            },
            {
              label: "Privacidad",
              text: "no se revela quién denunció. La moderación no lee los mensajes cifrados: solo puede actuar sobre lo que se le denuncia.",
            },
          ],
        },
      ],
    },
    {
      id: "apelaciones",
      heading: "Sanciones y apelaciones",
      blocks: [
        {
          kind: "p",
          text: "El correo de la suspensión incluye el motivo, el plazo y un enlace personal para apelar. El enlace vale 30 días y solo puede usarse una vez.",
        },
        {
          kind: "p",
          text: "La apelación la revisa otra persona del equipo, nunca quien impuso la sanción. Si se estima, la cuenta se reactiva y se avisa por correo; si se mantiene, la respuesta explica por qué. La decisión queda en la auditoría.",
        },
      ],
    },
    {
      id: "transparencia",
      heading: "Transparencia",
      blocks: [
        {
          kind: "p",
          text: "Las actuaciones de moderación quedan registradas en una auditoría interna con retención configurable. Cada instancia puede publicar informes agregados —denuncias, medidas y apelaciones— sin nombres ni casos concretos.",
        },
      ],
    },
    {
      id: "continuidad",
      heading: "Continuidad",
      blocks: [
        {
          kind: "p",
          text: "Una instancia no debería depender de una sola persona. La guía de despliegue recomienda al menos dos administradores, copias cifradas fuera del servidor y un procedimiento de relevo para el dominio, las credenciales y las copias.",
        },
      ],
    },
    {
      id: "cambios",
      heading: "Cambios en este documento",
      blocks: [
        {
          kind: "p",
          text: "La versión vigente se publica en esta página y en el repositorio, en GOVERNANCE.md. Cualquier cambio debe explicarse en el historial público del proyecto.",
        },
      ],
    },
  ],
};

const DE: TechnicalDocument = {
  title: "Governance",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek ist freie Software, und jede Instanz wird von ihrer Community geführt. Dieses Dokument trennt, was das Projekt zusichert, von dem, was jede Instanz entscheidet.",
    "Es erklärt außerdem, wie moderiert und sanktioniert wird und wie gegen eine Sanktion Einspruch eingelegt werden kann.",
  ],
  sections: [
    {
      id: "projekt-und-instanz",
      heading: "Projekt und Instanz",
      blocks: [
        {
          kind: "p",
          text: "Das Projekt veröffentlicht den Code unter der MIT-Lizenz, pflegt die Dokumentation und veröffentlicht Versionen. Jede Instanz entscheidet über ihre Regeln, wen sie aufnimmt und wie sie ihre Moderation organisiert: Das Projekt regiert die Instanzen nicht.",
        },
      ],
    },
    {
      id: "wer-macht-was",
      heading: "Wer macht was",
      blocks: [
        {
          kind: "terms",
          items: [
            { label: "Projektpflege", text: "prüft den Code, veröffentlicht Versionen und pflegt die technische Dokumentation. Sie verwaltet keine Instanzen." },
            { label: "Instanzverwaltung", text: "kümmert sich um Server, Backups und die Aufnahme ins Team und ist die einzige Stelle, die Konten sperren kann." },
            { label: "Moderation", text: "prüft Meldungen, verbirgt Inhalte und dokumentiert ihr Vorgehen. Sie sperrt keine Konten und ernennt niemanden." },
            { label: "Community", text: "beteiligt sich an Clubs und Listen, schlägt Änderungen vor und kann jede Entscheidung überprüfen lassen, die sie betrifft." },
          ],
        },
      ],
    },
    {
      id: "moderation",
      heading: "Wie moderiert wird",
      blocks: [
        {
          kind: "p",
          text: "Moderation schützt Menschen, sie bestraft nicht Unbehagen oder Widerspruch. Kritik, eine harsche Rezension oder ein unbequemes Gespräch sind für sich genommen kein Grund für eine Sanktion.",
        },
        {
          kind: "terms",
          items: [
            { label: "Verhältnismäßigkeit", text: "die mildeste Maßnahme, die das Problem löst: einen Inhalt verbergen statt ein Konto sperren." },
            { label: "Begründung", text: "jede Sanktion nennt die verletzte Regel und das Verhalten. Die betroffene Person erhält dies per E-Mail." },
            { label: "Frist", text: "Sperren haben eine konkrete Dauer von einem Tag bis zu einem Jahr und enden automatisch." },
            { label: "Privatsphäre", text: "wer gemeldet hat, wird nicht offengelegt. Die Moderation liest keine verschlüsselten Nachrichten." },
          ],
        },
      ],
    },
    {
      id: "einsprueche",
      heading: "Sanktionen und Einsprüche",
      blocks: [
        {
          kind: "p",
          text: "Die E-Mail zur Sperre enthält Grund, Frist und einen persönlichen Link für den Einspruch. Der Link gilt 30 Tage und kann einmal verwendet werden.",
        },
        {
          kind: "p",
          text: "Über den Einspruch entscheidet eine andere Person im Team, nie die Person, die die Sanktion verhängt hat. Wird ihm stattgegeben, wird das Konto reaktiviert und per E-Mail informiert; sonst erklärt die Antwort, warum. Die Entscheidung wird protokolliert.",
        },
      ],
    },
    {
      id: "transparenz",
      heading: "Transparenz",
      blocks: [
        {
          kind: "p",
          text: "Moderationsmaßnahmen werden in einem internen Prüfprotokoll mit konfigurierbarer Aufbewahrung festgehalten. Jede Instanz kann aggregierte Berichte veröffentlichen — Meldungen, Maßnahmen und Einsprüche — ohne Namen oder Einzelfälle.",
        },
      ],
    },
    {
      id: "kontinuitaet",
      heading: "Kontinuität",
      blocks: [
        {
          kind: "p",
          text: "Eine Instanz sollte nicht von einer einzigen Person abhängen. Die Betriebsanleitung empfiehlt mindestens zwei Administrator:innen, verschlüsselte Backups außerhalb des Servers und ein Übergabeverfahren für Domain, Zugangsdaten und Backups.",
        },
      ],
    },
    {
      id: "aenderungen",
      heading: "Änderungen dieses Dokuments",
      blocks: [
        {
          kind: "p",
          text: "Die gültige Fassung steht auf dieser Seite und im Repository unter GOVERNANCE.md. Jede Änderung muss in der öffentlichen Projektgeschichte erklärt werden.",
        },
      ],
    },
  ],
};

const EN: TechnicalDocument = {
  title: "Governance",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek is free software, and each instance is governed by its community. This document separates what the project guarantees from what each instance decides.",
    "It also explains how moderation works, how sanctions are applied and how a sanction can be appealed.",
  ],
  sections: [
    {
      id: "project-and-instance",
      heading: "Project and instance",
      blocks: [
        {
          kind: "p",
          text: "The project publishes the code under the MIT licence, maintains the documentation and publishes releases. Each instance decides its own rules, whom it admits and how it organises moderation: the project does not govern the instances.",
        },
      ],
    },
    {
      id: "who-does-what",
      heading: "Who does what",
      blocks: [
        {
          kind: "terms",
          items: [
            { label: "Project maintenance", text: "reviews the code, publishes releases and maintains the technical documentation. It does not administer instances." },
            { label: "Instance administration", text: "manages the server, backups and the team, and is the only role that can suspend accounts." },
            { label: "Moderation", text: "reviews reports, hides content and documents its actions. It does not suspend accounts or appoint the team." },
            { label: "Community", text: "takes part in circles and lists, proposes changes and can ask for any decision affecting them to be reviewed." },
          ],
        },
      ],
    },
    {
      id: "moderation",
      heading: "How moderation works",
      blocks: [
        {
          kind: "p",
          text: "Moderation protects people; it does not punish discomfort or disagreement. Criticism, a harsh review or an awkward conversation are not, by themselves, grounds for a sanction.",
        },
        {
          kind: "terms",
          items: [
            { label: "Proportionality", text: "the least restrictive measure that solves the problem: hiding content before suspending an account." },
            { label: "Reason", text: "every sanction states which rule was broken and which conduct led to it. The affected person receives this by email." },
            { label: "Time limit", text: "suspensions have a specific duration, from one day to one year, and end automatically." },
            { label: "Privacy", text: "the reporter is never revealed. Moderators do not read encrypted messages: they can only act on what is reported." },
          ],
        },
      ],
    },
    {
      id: "appeals",
      heading: "Sanctions and appeals",
      blocks: [
        {
          kind: "p",
          text: "The suspension email includes the reason, the time limit and a personal appeal link. The link is valid for 30 days and can be used once.",
        },
        {
          kind: "p",
          text: "The appeal is reviewed by another member of the team, never by the person who imposed the sanction. If upheld, the account is reactivated and the person is notified by email; if rejected, the reply explains why. The decision is recorded in the audit log.",
        },
      ],
    },
    {
      id: "transparency",
      heading: "Transparency",
      blocks: [
        {
          kind: "p",
          text: "Moderation actions are recorded in an internal audit log with configurable retention. Each instance may publish aggregate reports — reports, measures and appeals — without names or individual cases.",
        },
      ],
    },
    {
      id: "continuity",
      heading: "Continuity",
      blocks: [
        {
          kind: "p",
          text: "An instance should not depend on a single person. The deployment guide recommends at least two administrators, encrypted backups kept off the server and a handover procedure for the domain, credentials and backups.",
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes to this document",
      blocks: [
        {
          kind: "p",
          text: "The current version is published on this page and in the repository, in GOVERNANCE.md. Any change must be explained in the project's public history.",
        },
      ],
    },
  ],
};

export function governanceDocument(locale: Locale): TechnicalDocument {
  if (locale === "de") return DE;
  if (locale === "en") return EN;
  return ES;
}
