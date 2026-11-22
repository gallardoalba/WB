/**
 * Textos legales en inglés: política de privacidad (art. 13 RGPD) y aviso legal
 * (Impressum, § 5 DDG). Espejo de `legal.ts`; el tipo y la configuración vienen
 * de allí para que las tres versiones no puedan divergir en estructura.
 *
 * Igual que en las versiones alemana y española, los datos del responsable no
 * viven en el código: llegan por entorno. Si faltan, el texto lo dice en vez de
 * inventar una dirección.
 */

import { maskContact, type LegalConfig, type LegalDocument } from "./legal";

/** Fecha de la última revisión del texto (la misma que en `legal.ts`). */
const UPDATED = "2026-11-20";

const CONTROLLER_PLACEHOLDER_EN =
  "Not yet configured: set LEGAL_CONTROLLER, LEGAL_ADDRESS and LEGAL_CONTACT_EMAIL in the service environment.";

export function privacyDocumentEN(config: LegalConfig): LegalDocument {
  const responsible = config.complete
    ? [config.controller, config.address, maskContact(config.contact)].filter(Boolean)
    : [CONTROLLER_PLACEHOLDER_EN];
  const emailRecipient =
    config.emailProvider === "brevo"
      ? "Email provider: Brevo (Sendinblue SAS) receives the recipient address, subject and message content."
      : config.emailProvider === "webhook"
        ? "Email delivery: the configured mail webhook receives the recipient address, subject and full message text; the instance operator chooses the provider behind it."
        : null;
  const optionalRecipients: string[] = [];
  if (config.turnstileWidgetEnabled || config.turnstileVerificationEnabled) {
    const turnstileDetails = [
      ...(config.turnstileWidgetEnabled
        ? ["The browser loads the widget during registration, and Cloudflare receives connection data."]
        : []),
      ...(config.turnstileVerificationEnabled
        ? ["Server-side verification sends the token to Cloudflare and may include the IP address."]
        : []),
    ];
    optionalRecipients.push(
      `Cloudflare Turnstile: ${turnstileDetails.join(" ")}`,
    );
  }
  if (config.webPushEnabled) {
    optionalRecipients.push(
      "Web Push: only after activation and browser permission, the server stores the endpoint, subscription keys and user agent. The browser's push service (for example Google/FCM, Mozilla, Apple or Microsoft) receives encrypted delivery content and delivery metadata, and may also process browser connection data including the IP address.",
    );
  }
  if (config.mastodonEnabled) {
    optionalRecipients.push(
      "Mastodon: the configured instance receives posts about works announced by the team, including title, author, public URL and cover; visibility depends on the configuration.",
    );
  }
  if (config.mastodonLikesEnabled) {
    optionalRecipients.push(
      "Mastodon Likes: the application reads public hashtag posts and account profiles, and may like eligible public posts using the configured account.",
    );
  }
  if (config.errorWebhookEnabled) {
    optionalRecipients.push(
      "Error webhook: the configured endpoint receives redacted server-error data (time, message, stack and context); email addresses, tokens and request bodies are redacted before sending.",
    );
  }

  return {
    title: "Privacy policy",
    updated: UPDATED,
    intro: [
      "This policy explains which personal data Wanderbibliothek processes, for what purpose, for how long and to whom it is disclosed.",
      "It describes the code's data flows. Optional services are listed according to this deployment's detected configuration; the operator must verify actual providers, locations, legal bases and transfer safeguards.",
    ],
    sections: [
      { heading: "1. Data controller", body: responsible },
      {
        heading: "2. What data we process",
        body: [
          "Account: name, email address, town or city, short biography and language. Legal basis: performance of a contract (Art. 6(1)(b) GDPR (art. 6.1.b RGPD)).",
          "Password: stored only as a scrypt hash, never in plain text. Sessions: a random token that is likewise kept in the database only as a hash.",
          "Books and exchanges: title, condition, city, requests and ratings. Notes on a copy are voluntary. User-uploaded covers are publicly associated with the work; image metadata is removed before storage or delivery.",
          "Messages: encrypted in the browser (point 7). The server stores the encrypted text and the metadata (who, with whom, when); it does not accept unencrypted messages.",
          "Moderation: reports, sanctions with their reason and time limit, and appeals with the name of the reviewer, including external reviewers. Legal basis: legitimate interest in protecting people and maintaining a safe community (Art. 6(1)(f) GDPR).",
          "IP address: the application database stores only a daily pseudonym, not the address itself, for rate-limiting and protection against password attacks. Server access logs may retain the IP address (see retention periods).",
          "Email: to confirm the account, reset the password and give notice of activity. These notices can be switched off in the account.",
          "This information is necessary to provide the service: without a name, email address and password no account can be created. There is no automated decision-making and no profiling with legal effects on the person concerned.",
        ],
      },
      {
        heading: "3. Retention periods",
        body: [
          "Sessions: 14 days, with a maximum of 30 days from sign-in.",
          "Confirmation and reset links: 24 hours and 1 hour respectively; they are valid only once. The appeal link: 30 days.",
          "Email queue: completed or failed jobs are kept for up to 7 days and pending or running jobs for up to 30 days from creation. The email provider's own retention is governed by its terms.",
          "If the optional Mastodon Likes feature has been used: status and account identifiers, URL, hashtag, language and timestamp are deleted after 180 days.",
          ...(config.webPushEnabled
            ? ["Push subscriptions: until the user unsubscribes, deletes the account, or the push service reports that the endpoint no longer exists; up to six devices per account."]
            : []),
          "IP pseudonyms: no longer than 1 day.",
          "Notices: 90 days after being read and 180 days at most. Activity in the public area and in clubs: 180 days.",
          "Moderation log: up to 730 days (configurable). Sanctions: while active; the reason and time limit are deleted when the sanction is lifted.",
          "Resolved appeals: 2 years after resolution.",
          "Resolved reports: 1 year after they are resolved.",
          "Account and profile: until the account is deleted.",
          "Server logs: IP address, path without the query string and response code, following the system’s rotation (`logrotate`, 14 days by default). Search terms and single-use links are not logged.",
        ],
      },
      {
        heading: "4. Recipients and third parties",
        body: [
          ...(emailRecipient ? [emailRecipient] : []),
          "Bibliographic data: the server queries the German National Library (services.dnb.de) and Open Library. They receive the ISBN and the server's IP address, not the visitor's IP address; covers are no longer downloaded from these services.",
          "Place names: while the person types, the server asks Photon (Komoot GmbH), a search engine over OpenStreetMap data, for the list of municipalities; afterwards it checks the chosen name against Nominatim (OpenStreetMap Foundation) to catch typos. Only the typed text or the town name is sent, never the visitor’s IP address.",
          ...optionalRecipients,
          "Hosting: netcup GmbH.",
          "There are no analytics, advertising or tracking services, and no external fonts.",
          "International transfers: specific recipients and transfers outside the EEA depend on the configuration. The operator must identify the providers used, their locations and applicable safeguards; the code cannot confirm contracts or transfer mechanisms.",
        ],
      },
      {
        heading: "5. Cookies and local storage",
        body: [
          "Two technical cookies and no others: the session cookie (HttpOnly, Secure, SameSite=Lax, 14 days) for sign-in and, only after a manual language change, the language preference (1 year). Neither is used for advertising or analytics, and both are strictly necessary to provide the service (Germany: § 25(2) TDDDG; Austria: § 165(3) TKG 2021).",
          "The browser retains the chosen theme, dismissed onboarding tour and checklist, and messaging-key fingerprints until site data is cleared. These values are not sent to the server.",
          "For end-to-end encryption, the browser stores a non-exportable private key in IndexedDB. The server does not receive it; the application can use it for cryptographic operations. After account deletion, the local key remains until the browser's site data is cleared.",
          "In production, a service worker is registered automatically; it does not cache page responses and supports Push. A Push subscription is created only after activation and browser permission; that permission does not replace information about data processing.",
          ...(config.webPushEnabled
            ? ["For each Push device, the server stores the endpoint, delivery keys and user agent. Web Push encrypts the content, but the provider can still process the endpoint, delivery metadata and browser connection data, including the IP address. Unsubscribing and deleting the account remove the subscription; invalid endpoints are deleted during delivery."]
            : []),
        ],
      },
      {
        heading: "6. Visibility of the data",
        body: [
          "The profile (name, city, biography, books) is visible to signed-in users: this is what the community lives on.",
          "You can choose who sees your profile (the whole community, only people you follow, or nobody), whether your city is shown, whether the journey of your copies is told (cities and months, never people), whether you sign reviews and comments with your name or as a community member, and who may message you directly. The exact city is still shown in an accepted exchange, since without it you cannot meet.",
          "The home page and the catalogue can be browsed without an account. Without signing in, each copy shows only the book details and the city: never who offers it, their note or the exact date. When signed in, the record can tell the copy's journey: cities and months, never people.",
          "The catalogue, work pages, reading lists, reader directory and profiles carry a `noindex` directive and are omitted from the sitemap. Crawlers must be able to access those pages to read the directive; `robots.txt` is not access control. The directive does not prevent access to public content, and removal from existing search results may take time.",
        ],
      },
      {
        heading: "7. Encrypted messages",
        body: [
          "Messages are encrypted end to end (ECDH P-256 + AES-GCM). Neither the server nor whoever administers it can read them.",
          "If the browser’s storage is lost, old messages cannot be recovered: the server does not hold the key.",
        ],
      },
      {
        heading: "8. Your rights",
        body: [
          "Access and data portability: “Download data” in the account produces a JSON file containing everything that is stored.",
          "Rectification: name, city and biography can be changed at any time.",
          "Erasure: “Delete account” anonymises the account and removes sessions, notices, lists, your own clubs, blocks, favourites, personal notes, the published device keys and reviews, including those received. Exchange messages are kept with the author already anonymised, because they form part of other people’s history; direct conversations are deleted entirely, including for the other person.",
          "Objection to notification emails: at any time from the account.",
          "Complaint: to the competent data protection supervisory authority. In Germany, this is generally the authority for the relevant federal state; in Austria, it is the Austrian Data Protection Authority (Datenschutzbehörde, DSB).",
          "Restriction of processing: while an objection or an erasure is being examined, you may ask for processing to be restricted by writing to the contact address above.",
          "Withdrawal of consent: where you gave consent to something, for example notification emails, you may withdraw it at any time without giving reasons, from the account or by email; the lawfulness of the processing carried out beforehand is not affected.",
        ],
      },
      {
        heading: "9. Backups",
        body: [
          "A backup of the database is made every six hours. It may contain data that has since been deleted; the 14 most recent backups are kept (about three and a half days) and the external copy keeps 30.",
        ],
      },
      {
        heading: "10. Minimum age",
        body: [
          "The service is intended for people aged 16 and over. This is expressly confirmed at registration; the age is not verified.",
        ],
      },
      {
        heading: "11. Changes",
        body: ["If the processing changes, this text is updated."],
      },
    ],
  };
}

export function imprintDocumentEN(config: LegalConfig): LegalDocument {
  // § 5 DDG requires a name, an address and a means of fast contact; the
  // register entry and the VAT ID only where they exist.
  const details = config.complete
    ? [
        `Provider: ${config.controller}`,
        `Address: ${config.address}`,
        `Contact: ${maskContact(config.contact)}`,
        ...(config.phone ? [`Phone: ${config.phone}`] : []),
        ...(config.register ? [`Register entry: ${config.register}`] : []),
        ...(config.vatId ? [`VAT ID: ${config.vatId}`] : []),
      ]
    : [CONTROLLER_PLACEHOLDER_EN];

  return {
    title: "Legal notice",
    updated: UPDATED,
    intro: [
      "Provider identification details pursuant to § 5 DDG.",
      "This legal notice is based on the requirements applicable to providers established in Germany. Using the website from Austria does not, in itself, change the provider’s country of establishment or the legal requirements applicable to them. Providers established in Austria must ensure that their legal notice complies with the relevant Austrian disclosure requirements, including § 5 ECG and, where applicable, § 25 MedienG.",
    ],
    sections: [
      { heading: "Service provider", body: details },
      {
        heading: "Responsible for the content",
        body: [config.controller || CONTROLLER_PLACEHOLDER_EN],
      },
      {
        heading: "Liability for content and links",
        body: [
          "The content is published by the users. Liability for third-party content arises only once an infringement becomes known; at that point the content is removed.",
          "The operators of external pages are responsible for their own content.",
        ],
      },
    ],
  };
}
