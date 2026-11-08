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
const UPDATED = "2026-11-04";

const CONTROLLER_PLACEHOLDER_EN =
  "Not yet configured: set LEGAL_CONTROLLER, LEGAL_ADDRESS and LEGAL_CONTACT_EMAIL in the service environment.";

export function privacyDocumentEN(config: LegalConfig): LegalDocument {
  const responsible = config.complete
    ? [config.controller, config.address, maskContact(config.contact)].filter(Boolean)
    : [CONTROLLER_PLACEHOLDER_EN];

  return {
    title: "Privacy policy",
    updated: UPDATED,
    intro: [
      "This policy explains which personal data Wanderbibliothek processes, for what purpose, for how long and to whom it is disclosed.",
      "It is based on what the application actually does: every item mentioned here is data that the code stores.",
    ],
    sections: [
      { heading: "1. Data controller", body: responsible },
      {
        heading: "2. What data we process",
        body: [
          "Account: name, email address, town or city, short biography and language. Legal basis: performance of a contract (Art. 6(1)(b) GDPR (art. 6.1.b RGPD)).",
          "Password: stored only as a scrypt hash, never in plain text. Sessions: a random token that is likewise kept in the database only as a hash.",
          "Books and exchanges: title, condition, city, requests, hand-over codes and ratings. Notes on a copy are voluntary.",
          "Messages: encrypted in the browser (point 7). The server stores only the encrypted text and the metadata (who, with whom, when).",
          "IP address: used solely to rate-limit requests and to slow down password attacks, and stored only as a daily pseudonym, never as the address itself.",
          "Email: to confirm the account, reset the password and give notice of activity. These notices can be switched off in the account.",
          "This information is necessary to provide the service: without a name, email address and password no account can be created. There is no automated decision-making and no profiling with legal effects on the person concerned.",
        ],
      },
      {
        heading: "3. Retention periods",
        body: [
          "Sessions: 14 days, with a maximum of 30 days from sign-in.",
          "Confirmation and reset links: 24 hours and 1 hour respectively; they are valid only once.",
          "Sent emails: 7 days after delivery.",
          "IP pseudonyms: no longer than 1 day.",
          "Notices: 90 days after being read and 180 days at most. Activity in the public area: 180 days.",
          "Moderation log: up to 730 days (configurable).",
          "Account and profile: until the account is deleted.",
          "Server logs: IP address, path without the query string and response code, following the system’s rotation (`logrotate`, 14 days by default). Search terms and single-use links are not logged.",
        ],
      },
      {
        heading: "4. Recipients and third parties",
        body: [
          "Email provider: on this service, Brevo (Sendinblue SAS, Paris), which processes the data on our instructions and within the EU; it receives the address and the text of the notice, never the content of encrypted messages.",
          "Book covers: the images are downloaded through our server and cached; Open Library (Internet Archive) sees the server’s IP address and the ISBN, not the IP address of the visitor.",
          "Cloudflare Turnstile: only if enabled, when registering.",
          "Hosting: the provider on whose infrastructure this service runs.",
          "There are no analytics, advertising or tracking services, and no external fonts.",
          "International transfers: where a provider processes data outside the EEA (for example an email service in the United States), the transfer relies on the European Commission’s standard contractual clauses or on an adequacy decision. Which provider is used is a matter of the service configuration.",
        ],
      },
      {
        heading: "5. Cookies and local storage",
        body: [
          "Two technically necessary cookies: the session cookie (HttpOnly, Secure, SameSite=Lax, 14 days) and, only where the language is changed manually, the language setting (1 year). Neither serves advertising or analytics, and neither requires consent.",
          "Stored in the browser: the chosen theme and language, and the fingerprints of your correspondents’ keys.",
          "The private half of the encryption key lives in IndexedDB and cannot be read out by JavaScript.",
        ],
      },
      {
        heading: "6. Visibility of the data",
        body: [
          "The profile (name, city, biography, books) is visible to signed-in users: this is what the community lives on.",
          "Search engines may not index the catalogue or the profiles (robots.txt), and the catalogue is no longer reachable without an account.",
        ],
      },
      {
        heading: "7. Encrypted messages",
        body: [
          "Messages are encrypted end to end (ECDH P-256 + AES-GCM). Neither the server nor whoever administers it can read them.",
          "The price of this: if the browser’s storage is lost, old messages cannot be recovered.",
        ],
      },
      {
        heading: "8. Your rights",
        body: [
          "Access and data portability: “Download data” in the account produces a JSON file containing everything that is stored.",
          "Rectification: name, city and biography can be changed at any time.",
          "Erasure: “Delete account” anonymises the account and removes sessions, notices, lists, your own clubs, blocks, favourites and personal notes. Messages and ratings are kept with the author already anonymised, because they form part of other people’s history.",
          "Objection to notification emails: at any time from the account.",
          "Complaint: to the data protection supervisory authority of your federal state.",
          "Restriction of processing: while an objection or an erasure is being examined, you may ask for processing to be restricted by writing to the contact address above.",
          "Withdrawal of consent: where you gave consent to something — for example notification emails — you may withdraw it at any time without giving reasons, from the account or by email; the lawfulness of the processing carried out beforehand is not affected.",
        ],
      },
      {
        heading: "9. Backups",
        body: [
          "A backup of the database is made every day. It may contain data that has since been deleted, and it is overwritten after 14 days.",
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
        body: ["If the processing changes, this text is updated. The date above states the version."],
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
    intro: ["Provider identification details pursuant to § 5 DDG."],
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
