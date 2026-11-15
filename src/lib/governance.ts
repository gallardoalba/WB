import type { Locale } from "./locale";
import type { TechnicalDocument } from "./technical";

const UPDATED = "2026-11-15";

const ES: TechnicalDocument = {
  title: "Gobernanza",
  updated: UPDATED,
  intro: [
    "Wanderbibliothek es software libre y cada instancia la gobierna su comunidad. Este documento separa lo que garantiza el proyecto de lo que decide cada instancia.",
    "También explica cómo se modera y cómo se apela una sanción.",
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
          text: "Las normas de conducta de cada instancia, es decir, qué no se admite y qué medida corresponde a cada caso, deben ser públicas y estar visibles antes de registrarse. Este documento describe el procedimiento; no las sustituye.",
        },
        {
          kind: "p",
          text: "Esas normas no bastan por sí solas. Hasta la instancia más pequeña explica sus decisiones de moderación y permite apelar una suspensión.",
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
              text: "revisa denuncias, oculta contenido y documenta sus actuaciones. Propone suspensiones, pero no las aplica ni nombra al equipo.",
            },
            {
              label: "Comunidad",
              text: "participa en clubes y listas y propone cambios; además puede pedir la revisión de cualquier decisión que le afecte.",
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
          text: "Se modera para proteger a las personas. La incomodidad o el desacuerdo no son motivo de sanción, y una crítica dura o una conversación incómoda tampoco.",
        },
        {
          kind: "terms",
          items: [
            {
              label: "Proporcionalidad",
              text: "se aplica la medida menos restrictiva que resuelve el problema. Solo se sube de nivel cuando la anterior no ha funcionado: primero una corrección, después ocultar el contenido y al final suspender la cuenta. Un daño grave o en curso, como amenazas, datos personales publicados o acoso sostenido, justifica actuar de inmediato. La reincidencia pesa en la decisión y la auditoría guarda el historial.",
            },
            {
              label: "Quién decide",
              text: "la moderación investiga y propone; la administración decide y aplica la suspensión. Si una misma persona reúne ambos papeles, la decisión se toma como administración y así queda registrada.",
            },
            {
              label: "Contenido del aviso",
              text: "nombra la norma incumplida, la conducta que la motiva y cómo llegó el caso al equipo (por una denuncia o por revisión propia), en el idioma de la cuenta.",
            },
            {
              label: "Plazo",
              text: "las suspensiones tienen una duración concreta, de un día a un año, y se levantan solas al vencer.",
            },
            {
              label: "Privacidad",
              text: "quien denunció no aparece ante la persona sancionada ni en público; el equipo sí necesita saber quién fue para valorar el caso. La moderación no lee los mensajes cifrados: solo puede actuar sobre lo que se le denuncia.",
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
          text: "La apelación se envía desde esta página sin iniciar sesión, porque una cuenta suspendida no puede entrar, y admite cualquier información que la persona considere relevante. Si el enlace se pierde o caduca, puede pedir otro desde esta misma página con el correo de la cuenta.",
        },
        {
          kind: "p",
          text: "La revisión la hace alguien ajeno a la decisión original y sin conflicto de interés, y se responde en un plazo máximo de 14 días. Si la instancia no tiene a nadie disponible, puede hacerlo una persona externa y su nombre queda registrado. Quien revisa puede levantar la suspensión o mantenerla; la aplicación no permite acortarla.",
        },
        {
          kind: "p",
          text: "Si se estima, la cuenta se reactiva y se avisa por correo; si se mantiene, la respuesta explica por qué. La decisión queda en la auditoría. Solo puede haber una apelación abierta a la vez por sanción; un rechazo no impide otra posterior si la persona consigue un enlace nuevo. Las apelaciones resueltas se borran a los 730 días, tiempo suficiente para valorar la reincidencia y responder a una reclamación posterior.",
        },
      ],
    },
    {
      id: "transparencia",
      heading: "Transparencia",
      blocks: [
        {
          kind: "p",
          text: "Las actuaciones de moderación quedan registradas en una auditoría interna que solo puede leer el equipo. La aplicación nunca la edita y la poda según AUDIT_RETENTION_DAYS. Cada instancia publica al menos una vez al año un informe agregado, sin nombres ni casos concretos. Recoge las denuncias recibidas y su resultado, las medidas aplicadas, las suspensiones activas y las apelaciones con su resultado y su tiempo medio de respuesta. En una comunidad pequeña el detalle por caso permitiría identificar personas, así que el informe se queda en cifras.",
        },
        {
          kind: "p",
          text: "Aparte de ese informe, cada instancia publica instantáneas firmadas del catálogo público en `/api/transparency`: las obras ofrecidas y las ciudades donde están, nunca quién tiene cada ejemplar. Cualquiera puede descargar el contenido exacto, recalcular su raíz y comprobar la firma. La moderación no se publica caso por caso por la misma razón: en una comunidad pequeña señalaría a personas.",
        },
      ],
    },
    {
      id: "continuidad",
      heading: "Continuidad",
      blocks: [
        {
          kind: "p",
          text: "Una instancia no debería depender de una sola persona. La guía de despliegue recomienda al menos dos administradores, copias cifradas fuera del servidor y un procedimiento de relevo para el dominio, las credenciales y las copias. Pide además un procedimiento de cierre que avise a los miembros, les dé plazo para exportar sus datos y borre lo que la ley no obligue a conservar.",
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
    "Es erklärt außerdem, wie moderiert wird und wie gegen eine Sanktion Einspruch eingelegt werden kann.",
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
          text: "Die Verhaltensregeln jeder Instanz, also was nicht geduldet wird und welche Maßnahme zu welchem Fall gehört, müssen öffentlich und vor der Registrierung sichtbar sein. Dieses Dokument beschreibt das Verfahren; es ersetzt sie nicht.",
        },
        {
          kind: "p",
          text: "Regeln allein genügen nicht. Auch die kleinste Instanz begründet ihre Moderationsentscheidungen und lässt gegen eine Sperre Einspruch zu.",
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
            { label: "Moderation", text: "prüft Meldungen, verbirgt Inhalte und dokumentiert ihr Vorgehen. Sie schlägt Sperren vor, verhängt sie aber nicht, und ernennt niemanden." },
            { label: "Community", text: "beteiligt sich an Clubs und Listen und schlägt Änderungen vor; außerdem kann sie jede Entscheidung überprüfen lassen, die sie betrifft." },
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
          text: "Moderation schützt Menschen. Unbehagen oder Widerspruch sind kein Grund für eine Sanktion, eine harsche Kritik oder ein unbequemes Gespräch auch nicht.",
        },
        {
          kind: "terms",
          items: [
            { label: "Verhältnismäßigkeit", text: "die mildeste Maßnahme, die das Problem löst. Erst wenn sie nicht wirkt, wird gesteigert: zuerst eine Korrektur, dann das Verbergen des Inhalts, zuletzt die Sperre des Kontos. Bei schwerem oder andauerndem Schaden, etwa Drohungen, veröffentlichten persönlichen Daten oder anhaltender Belästigung, ist sofortiges Handeln gerechtfertigt. Wiederholtes Verhalten zählt bei der Entscheidung, und das Protokoll hält den Verlauf fest." },
            { label: "Wer entscheidet", text: "die Moderation untersucht und schlägt vor; die Verwaltung entscheidet und verhängt die Sperre. Vereint eine Person beide Rollen, wird die Entscheidung als Verwaltung getroffen und so protokolliert." },
            { label: "Inhalt des Hinweises", text: "er nennt die verletzte Regel, das Verhalten dahinter und wie der Fall zum Team kam (durch eine Meldung oder durch eigene Prüfung), in der Sprache des Kontos." },
            { label: "Frist", text: "Sperren haben eine konkrete Dauer von einem Tag bis zu einem Jahr und enden automatisch." },
            { label: "Privatsphäre", text: "wer gemeldet hat, erfährt die gesperrte Person nicht, und öffentlich wird es auch nicht; das Team muss es aber wissen, um die Meldung zu bewerten. Die Moderation liest keine verschlüsselten Nachrichten: sie kann nur auf Meldungen reagieren." },
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
          text: "Der Einspruch wird auf dieser Seite ohne Anmeldung eingereicht, weil ein gesperrtes Konto sich nicht anmelden kann, und kann jede Information enthalten, die die Person für relevant hält. Geht der Link verloren oder läuft er ab, lässt sich auf derselben Seite mit der E-Mail des Kontos ein neuer anfordern.",
        },
        {
          kind: "p",
          text: "Geprüft wird von jemandem, der an der ursprünglichen Entscheidung nicht beteiligt war und keinen Interessenkonflikt hat; geantwortet wird innerhalb von 14 Tagen. Hat die Instanz niemanden frei, kann das eine externe Person übernehmen, deren Name protokolliert wird. Sie kann die Sperre aufheben oder bestätigen; die Anwendung erlaubt keine Verkürzung.",
        },
        {
          kind: "p",
          text: "Wird ihm stattgegeben, wird das Konto reaktiviert und per E-Mail informiert; sonst erklärt die Antwort, warum. Die Entscheidung wird protokolliert. Pro Sanktion ist ein offener Einspruch möglich; eine Ablehnung verhindert keinen späteren, wenn die Person einen neuen Link erhält. Entschiedene Einsprüche werden nach 730 Tagen gelöscht, genug, um wiederholtes Verhalten zu bewerten und eine spätere Beschwerde zu beantworten.",
        },
      ],
    },
    {
      id: "transparenz",
      heading: "Transparenz",
      blocks: [
        {
          kind: "p",
          text: "Moderationsmaßnahmen werden in einem internen Protokoll festgehalten, das nur das Team lesen kann. Die Anwendung ändert es nie und kürzt es nach AUDIT_RETENTION_DAYS. Jede Instanz veröffentlicht mindestens einmal im Jahr einen aggregierten Bericht, ohne Namen und ohne Einzelfälle. Er nennt die eingegangenen Meldungen und ihr Ergebnis, die angewandten Maßnahmen, die aktiven Sperren sowie die Einsprüche mit Ergebnis und durchschnittlicher Antwortzeit. In einer kleinen Community würden Einzelfälle auf Personen schließen lassen, deshalb bleibt der Bericht bei Zahlen.",
        },
        {
          kind: "p",
          text: "Unabhängig davon veröffentlicht jede Instanz unter `/api/transparency` signierte Momentaufnahmen des öffentlichen Katalogs: die angebotenen Werke und die Städte, in denen sie sind, nie wer ein Exemplar besitzt. Jede Person kann den genauen Inhalt herunterladen, seine Wurzel neu berechnen und die Signatur prüfen. Die Moderation wird aus demselben Grund nicht Fall für Fall veröffentlicht: In einer kleinen Community würde das auf Personen zeigen.",
        },
      ],
    },
    {
      id: "kontinuitaet",
      heading: "Kontinuität",
      blocks: [
        {
          kind: "p",
          text: "Eine Instanz sollte nicht von einer einzigen Person abhängen. Die Betriebsanleitung empfiehlt mindestens zwei Administrator:innen, verschlüsselte Backups außerhalb des Servers und ein Übergabeverfahren für Domain, Zugangsdaten und Backups. Dazu kommt ein Verfahren zum Schließen der Instanz: Es kündigt die Schließung den Mitgliedern an, lässt ihnen Zeit für den Export ihrer Daten und löscht, was nicht gesetzlich aufzubewahren ist.",
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
    "It also explains how moderation works and how a sanction can be appealed.",
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
          text: "The rules of conduct of each instance, that is, what is not admitted and which measure corresponds to each case, must be public and visible before registering. This document describes the procedure; it does not replace those rules.",
        },
        {
          kind: "p",
          text: "Rules alone are not enough. Even the smallest instance explains its moderation decisions and lets a suspension be appealed.",
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
            { label: "Moderation", text: "reviews reports, hides content and documents its actions. It proposes suspensions but does not apply them, and it does not appoint the team." },
            { label: "Community", text: "takes part in circles and lists and proposes changes; it can also ask for any decision affecting it to be reviewed." },
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
          text: "Moderation protects people. Discomfort or disagreement is not grounds for a sanction, and neither is a harsh review or an awkward conversation.",
        },
        {
          kind: "terms",
          items: [
            { label: "Proportionality", text: "the least restrictive measure that solves the problem. Escalate only when a lesser measure has not worked: a correction first, then hiding the content, then a suspension. Serious or ongoing harm, such as threats, published personal data or sustained harassment, justifies acting immediately. Repeated conduct weighs in the decision, and the audit log keeps the record." },
            { label: "Who decides", text: "moderation investigates and proposes; administration decides and applies a suspension. When one person holds both roles, the decision is taken under the administration role and recorded as such." },
            { label: "What it contains", text: "the rule that was broken, the conduct behind it and how the case reached the team (a report or a proactive review), in the language of the account." },
            { label: "Time limit", text: "suspensions have a specific duration, from one day to one year, and end automatically." },
            { label: "Privacy", text: "the reporter is not named to the sanctioned person or in public; the team does need to know who it was in order to assess the case. Moderators do not read encrypted messages: they act on what is reported." },
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
          text: "The appeal is submitted from this page without signing in, because a suspended account cannot log in, and may include any information the person considers relevant. If the link is lost or expires, a new one can be requested from the same page with the account email.",
        },
        {
          kind: "p",
          text: "Someone with no part in the original decision and no conflict of interest reviews it, and the answer arrives within 14 days. Where the instance has nobody available, an external reviewer may do it and their name is recorded. The reviewer may lift the suspension or uphold it; the application does not allow shortening it.",
        },
        {
          kind: "p",
          text: "If upheld, the account is reactivated and the person is notified by email; if rejected, the reply explains why. The decision is recorded in the audit log. One appeal may be open at a time per sanction; a rejection does not prevent a later one if the person obtains a new link. Resolved appeals are deleted after 730 days, enough to judge repeated conduct and to answer a later complaint.",
        },
      ],
    },
    {
      id: "transparency",
      heading: "Transparency",
      blocks: [
        {
          kind: "p",
          text: "Moderation actions are recorded in an internal audit log that only the team can read. The application never edits it and prunes it according to AUDIT_RETENTION_DAYS. Each instance publishes an aggregate report at least once a year, without names or individual cases. It covers reports received and their outcome, measures applied, active suspensions, and appeals with their outcome and average response time. In a small community per-case detail would identify people, so the report stays at aggregate figures.",
        },
        {
          kind: "p",
          text: "Separately, each instance publishes signed snapshots of the public catalogue at `/api/transparency`: the works on offer and the cities where they are, never who owns a copy. Anyone can download the exact content, recompute its root and check the signature. Moderation is not published case by case for the same reason: in a small community it would point at people.",
        },
      ],
    },
    {
      id: "continuity",
      heading: "Continuity",
      blocks: [
        {
          kind: "p",
          text: "An instance should not depend on a single person. The deployment guide recommends at least two administrators, encrypted backups kept off the server and a handover procedure for the domain, credentials and backups. It also asks for a closure procedure: it tells the members, gives them time to export their data and deletes what the law does not require keeping.",
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
