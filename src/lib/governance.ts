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
        {
          kind: "p",
          text: "Las normas de conducta de cada instancia —qué no se admite y qué medida corresponde a cada caso— deben ser públicas y estar visibles antes de registrarse. Este documento describe el procedimiento; no las sustituye.",
        },
        {
          kind: "p",
          text: "Sea cual sea su tamaño, una instancia debe publicar sus normas, explicar cada decisión de moderación y ofrecer una vía para apelar una suspensión.",
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
              text: "revisa denuncias, oculta contenido, documenta sus actuaciones y propone suspensiones. No suspende cuentas ni nombra al equipo.",
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
              text: "se aplica la medida menos restrictiva que resuelve el problema y solo se sube de nivel cuando la anterior no ha funcionado: primero una corrección, después ocultar el contenido y al final suspender la cuenta. Un daño grave o en curso —amenazas, datos personales publicados, acoso sostenido— justifica actuar de inmediato. La reincidencia pesa en la decisión y la auditoría guarda el historial.",
            },
            {
              label: "Quién decide",
              text: "la moderación investiga y propone; la administración decide y aplica la suspensión. Si una misma persona reúne ambos papeles, la decisión se toma como administración y así queda registrada.",
            },
            {
              label: "Aviso",
              text: "el aviso dice qué norma se ha incumplido, qué conducta lo motiva y cómo llegó el caso al equipo —por una denuncia o por revisión propia—, en el idioma de la cuenta.",
            },
            {
              label: "Plazo",
              text: "las suspensiones tienen una duración concreta, de un día a un año, y se levantan solas al vencer.",
            },
            {
              label: "Privacidad",
              text: "quién denunció no se revela a la persona sancionada ni públicamente; el equipo sí necesita saberlo para valorar la denuncia. La moderación no lee los mensajes cifrados: solo puede actuar sobre lo que se le denuncia.",
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
          text: "El correo de la suspensión incluye el motivo, la fecha de fin y un enlace personal para apelar, en el idioma de la cuenta. El enlace vale 30 días y solo puede usarse una vez.",
        },
        {
          kind: "p",
          text: "La apelación se envía desde esta página sin iniciar sesión —una cuenta suspendida no puede entrar— y admite cualquier información que la persona considere relevante. Si el enlace se pierde o caduca, puede pedir otro desde esta misma página con el correo de la cuenta.",
        },
        {
          kind: "p",
          text: "La revisa alguien sin participación en la decisión original y sin conflicto de interés, y responde en un plazo máximo de 14 días; si la instancia no tiene a nadie disponible, puede hacerlo una persona externa y su nombre queda registrado. Puede levantar la suspensión o mantenerla; la aplicación no permite acortarla.",
        },
        {
          kind: "p",
          text: "Si se estima, la cuenta se reactiva y se avisa por correo; si se mantiene, la respuesta explica por qué. La decisión queda en la auditoría. Solo puede haber una apelación abierta a la vez por sanción; un rechazo no impide otra posterior si la persona consigue un enlace nuevo. Las resueltas se borran a los 730 días —tiempo suficiente para valorar la reincidencia y responder a una reclamación posterior—.",
        },
      ],
    },
    {
      id: "transparencia",
      heading: "Transparencia",
      blocks: [
        {
          kind: "p",
          text: "Las actuaciones de moderación quedan registradas en una auditoría interna que solo puede leer el equipo, que la aplicación nunca edita y que se poda según AUDIT_RETENTION_DAYS. Cada instancia publica al menos una vez al año un informe agregado —denuncias recibidas y su resultado, medidas aplicadas, suspensiones activas y apelaciones con su resultado y tiempo medio de respuesta— sin nombres ni casos concretos. En una comunidad pequeña, el detalle por caso permite identificar personas: el informe se queda en cifras agregadas.",
        },
      ],
    },
    {
      id: "continuidad",
      heading: "Continuidad",
      blocks: [
        {
          kind: "p",
          text: "Una instancia no debería depender de una sola persona. La guía de despliegue recomienda al menos dos administradores, copias cifradas fuera del servidor, un procedimiento de relevo para el dominio, las credenciales y las copias, y un procedimiento de cierre: aviso a sus miembros, plazo para exportar sus datos y borrado de lo que la ley no obligue a conservar.",
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
        {
          kind: "p",
          text: "Die Verhaltensregeln jeder Instanz — was nicht geduldet wird und welche Maßnahme zu welchem Fall gehört — müssen öffentlich und vor der Registrierung sichtbar sein. Dieses Dokument beschreibt das Verfahren; es ersetzt sie nicht.",
        },
        {
          kind: "p",
          text: "Unabhängig von ihrer Größe muss jede Instanz ihre Regeln veröffentlichen, jede Moderationsentscheidung begründen und einen Weg bieten, gegen eine Sperre Einspruch einzulegen.",
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
            { label: "Moderation", text: "prüft Meldungen, verbirgt Inhalte, dokumentiert ihr Vorgehen und schlägt Sperren vor. Sie sperrt keine Konten und ernennt niemanden." },
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
            { label: "Verhältnismäßigkeit", text: "die mildeste Maßnahme, die das Problem löst; erst wenn sie nicht wirkt, wird gesteigert: zuerst eine Korrektur, dann das Verbergen des Inhalts, zuletzt die Sperre des Kontos. Bei schwerem oder andauerndem Schaden — Drohungen, veröffentlichte persönliche Daten, anhaltende Belästigung — ist sofortiges Handeln gerechtfertigt. Wiederholtes Verhalten zählt bei der Entscheidung, und das Protokoll hält den Verlauf fest." },
            { label: "Wer entscheidet", text: "die Moderation untersucht und schlägt vor; die Verwaltung entscheidet und verhängt die Sperre. Vereint eine Person beide Rollen, wird die Entscheidung als Verwaltung getroffen und so protokolliert." },
            { label: "Hinweis", text: "der Hinweis nennt die verletzte Regel, das Verhalten dahinter und wie der Fall zum Team kam — durch eine Meldung oder durch eigene Prüfung —, in der Sprache des Kontos." },
            { label: "Frist", text: "Sperren haben eine konkrete Dauer von einem Tag bis zu einem Jahr und enden automatisch." },
            { label: "Privatsphäre", text: "wer gemeldet hat, wird der gesperrten Person und der Öffentlichkeit nicht genannt; das Team muss es aber wissen, um die Meldung zu bewerten. Die Moderation liest keine verschlüsselten Nachrichten: sie kann nur auf Meldungen reagieren." },
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
          text: "Die E-Mail zur Sperre enthält Grund, Enddatum und einen persönlichen Link für den Einspruch, in der Sprache des Kontos. Der Link gilt 30 Tage und kann einmal verwendet werden.",
        },
        {
          kind: "p",
          text: "Der Einspruch wird auf dieser Seite ohne Anmeldung eingereicht — ein gesperrtes Konto kann sich nicht anmelden — und kann jede Information enthalten, die die Person für relevant hält. Geht der Link verloren oder läuft er ab, lässt sich auf derselben Seite mit der E-Mail des Kontos ein neuer anfordern.",
        },
        {
          kind: "p",
          text: "Geprüft wird von jemandem ohne Beteiligung am ursprünglichen Entscheid und ohne Interessenkonflikt, mit Antwort innerhalb von 14 Tagen; hat die Instanz niemanden frei, kann das eine externe Person übernehmen, deren Name protokolliert wird. Sie kann die Sperre aufheben oder bestätigen; die Anwendung erlaubt keine Verkürzung.",
        },
        {
          kind: "p",
          text: "Wird ihm stattgegeben, wird das Konto reaktiviert und per E-Mail informiert; sonst erklärt die Antwort, warum. Die Entscheidung wird protokolliert. Pro Sanktion ist jeweils ein offener Einspruch möglich; eine Ablehnung verhindert keinen späteren, wenn die Person einen neuen Link erhält. Entschiedene Einsprüche werden nach 730 Tagen gelöscht — genug, um wiederholtes Verhalten zu bewerten und eine spätere Beschwerde zu beantworten.",
        },
      ],
    },
    {
      id: "transparenz",
      heading: "Transparenz",
      blocks: [
        {
          kind: "p",
          text: "Moderationsmaßnahmen werden in einem internen Protokoll festgehalten, das nur das Team lesen kann, das die Anwendung nie ändert und das nach AUDIT_RETENTION_DAYS gekürzt wird. Jede Instanz veröffentlicht mindestens einmal im Jahr einen aggregierten Bericht — eingegangene Meldungen und ihr Ergebnis, angewandte Maßnahmen, aktive Sperren sowie Einsprüche mit Ergebnis und durchschnittlicher Antwortzeit — ohne Namen und ohne Einzelfälle. In einer kleinen Community lassen Einzelfälle auf Personen schließen: der Bericht bleibt aggregiert.",
        },
      ],
    },
    {
      id: "kontinuitaet",
      heading: "Kontinuität",
      blocks: [
        {
          kind: "p",
          text: "Eine Instanz sollte nicht von einer einzigen Person abhängen. Die Betriebsanleitung empfiehlt mindestens zwei Administrator:innen, verschlüsselte Backups außerhalb des Servers, ein Übergabeverfahren für Domain, Zugangsdaten und Backups sowie ein Verfahren zum Schließen der Instanz: Ankündigung an die Mitglieder, Frist zum Exportieren der Daten und Löschung dessen, was nicht gesetzlich aufzubewahren ist.",
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
        {
          kind: "p",
          text: "The rules of conduct of each instance — what is not admitted and which measure corresponds to each case — must be public and visible before registering. This document describes the procedure; it does not replace those rules.",
        },
        {
          kind: "p",
          text: "Whatever its size, an instance must publish its rules, explain every moderation decision and offer a way to appeal a suspension.",
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
            { label: "Moderation", text: "reviews reports, hides content, documents its actions and proposes suspensions. It does not suspend accounts or appoint the team." },
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
            { label: "Proportionality", text: "the least restrictive measure that solves the problem, escalating only when a lesser measure has not worked: a correction first, then hiding the content, then a suspension. Serious or ongoing harm — threats, publishing personal data, sustained harassment — justifies acting immediately. Repeated conduct weighs in the decision, and the audit log keeps the record." },
            { label: "Who decides", text: "moderation investigates and proposes; administration decides and applies a suspension. When one person holds both roles, the decision is taken under the administration role and recorded as such." },
            { label: "Notice", text: "the notice states which rule was broken, which conduct led to it and how the case reached the team — a report or a proactive review — in the language of the account." },
            { label: "Time limit", text: "suspensions have a specific duration, from one day to one year, and end automatically." },
            { label: "Privacy", text: "the reporter is not revealed to the sanctioned person or publicly; the team does need to know who reported in order to assess the report. Moderators do not read encrypted messages: they act on what is reported." },
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
          text: "The suspension email includes the reason, the end date and a personal appeal link, in the language of the account. The link is valid for 30 days and can be used once.",
        },
        {
          kind: "p",
          text: "The appeal is submitted from this page without signing in — a suspended account cannot log in — and may include any information the person considers relevant. If the link is lost or expires, a new one can be requested from the same page with the account email.",
        },
        {
          kind: "p",
          text: "Someone with no part in the original decision and no conflict of interest reviews it and answers within 14 days; where the instance has nobody available, an external reviewer may do it and their name is recorded. The reviewer may lift the suspension or uphold it; the application does not allow shortening it.",
        },
        {
          kind: "p",
          text: "If upheld, the account is reactivated and the person is notified by email; if rejected, the reply explains why. The decision is recorded in the audit log. One appeal may be open at a time per sanction; a rejection does not prevent a later one if the person obtains a new link. Resolved appeals are deleted after 730 days — enough to judge repeated conduct and to answer a later complaint.",
        },
      ],
    },
    {
      id: "transparency",
      heading: "Transparency",
      blocks: [
        {
          kind: "p",
          text: "Moderation actions are recorded in an internal audit log that only the team can read, that the application never edits and that is pruned according to AUDIT_RETENTION_DAYS. Each instance publishes an aggregate report at least once a year — reports received and their outcome, measures applied, active suspensions and appeals with their outcome and average response time — without names or individual cases. In a small community, per-case detail can identify people: the report stays aggregate.",
        },
      ],
    },
    {
      id: "continuity",
      heading: "Continuity",
      blocks: [
        {
          kind: "p",
          text: "An instance should not depend on a single person. The deployment guide recommends at least two administrators, encrypted backups kept off the server, a handover procedure for the domain, credentials and backups, and a procedure for closing the instance: notice to its members, a window to export their data and deletion of what is not required by law.",
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
