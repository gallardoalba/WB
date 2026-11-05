# Wanderbibliothek

**Bücher, die weiterreisen.**

Wanderbibliothek bringt Menschen zusammen, die gelesene Bücher nicht im Regal verstauben lassen wollen. Wer ein Buch einstellt, macht es für andere in der Nähe auffindbar; wer eines sucht, fragt danach, und beide einigen sich auf die Übergabe. Kein Preis, keine Provision, kein Warenkorb – nur ein Buch, ein Gespräch und jemand, der es als Nächstes liest.

Die Plattform ist bewusst als Gegenentwurf zu kommerziellen Marktplätzen gebaut: Sie verkauft nichts, wirbt nicht, verfolgt niemanden und belohnt niemanden für Aktivität. Sie geht davon aus, dass Menschen teilen, wenn man es ihnen leicht macht und ihnen nicht misstraut – und dass eine Gemeinschaft ihre Regeln selbst aushandeln kann.

## Was die Plattform kann

- **Bücher einstellen.** ISBN eingeben, den Rest liefern die Deutsche Nationalbibliothek und Open Library: Titel, Autor:in, Sprache, Kategorie. Fehlt ein Cover, entsteht eine gesetzte Titelkarte.
- **Tauschen.** Anfrage, Annahme, Übergabe, beidseitige Bestätigung mit einem sechsstelligen Code, danach eine Bewertung. Beide Seiten bestätigen getrennt, damit niemand den Tausch allein abschließen kann.
- **Verschicken, ohne die Adresse zu verraten.** Das Buch geht als Warensendung an eine Packstation oder an die eigene Adresse der empfangenden Person. Alle Versandfelder liegen verschlüsselt und sind nur für die beiden Tauschpartner:innen lesbar.
- **Werke statt Angebote.** Alle Ausgaben eines Titels teilen sich eine Seite: Gespräch, verfügbare Exemplare, Empfehlungen und der Hinweis, wer in der eigenen Stadt genau dieses Buch sucht.
- **Lesekreise.** Nach Stadt, mit laufender Lektüre, Treffen, Teilnahmeliste, Abstimmung über das nächste Buch und einem Forum, das nur die Mitglieder lesen.
- **Listen, Verzeichnis, Aktivität.** Leselisten als öffentliche Kuratierung, ein Verzeichnis der Leser:innen mit Sortierung nach Nähe und ein Strom dessen, was in der eigenen Umgebung passiert.
- **Selbst gehostet.** Eine Instanz läuft auf einem kleinen Server mit SQLite, ohne fremde Dienste. Ohne Konto lassen sich Startseite, Rechtstexte und die technische Dokumentation lesen.

## Grundsätze

**Gegenseitigkeit.** Wer ein Buch abgibt, bekommt eines zurück. Es gibt keine Währung, kein Guthaben und keine Punkte, die jemanden zum Viel-Tauschen antreiben – nur die Erwartung, dass man selbst auch gibt.

**Unentgeltlich.** Keine Gebühren, keine Premium-Stufe, keine Werbung, keine Weitergabe von Daten an Dritte. Was die Plattform nicht kostet, muss sie auch nicht einnehmen – und was sie nicht einnimmt, kann sie niemandem verkaufen.

**Bücher als Gemeingut.** Ein gelesenes Buch ist kein Ladenhüter, sondern etwas, das weitergegeben werden will. Die Plattform verwaltet deshalb kein Eigentum, sondern Übergaben: Wer ein Exemplar weitergibt, verliert es nicht, sondern bringt es in Umlauf.

**Selbstorganisation.** Was ein Lesekreis liest, wann er sich trifft und wer hineinkommt, entscheidet der Lesekreis – nicht eine Zentrale. Auch Moderation ist umkehrbar und nachvollziehbar: Zurückgezogenes lässt sich wiederherstellen, und jede Entscheidung hinterlässt eine Spur.

**Transparenz.** Der Quellcode ist offen, und die Regeln stehen dort, wo sie gelten. Wer wissen will, was mit den eigenen Daten passiert, kann es nachlesen statt es zu glauben.

**Privatsphäre.** Keine Werbe- oder Analysedienste, keine Profile für Dritte. Nachrichten zwischen zwei Menschen sind Ende-zu-Ende verschlüsselt, Versanddaten sind verschlüsselt, und alle eigenen Daten lassen sich als JSON exportieren und vollständig löschen.

**Autonomie.** Keine Abhängigkeit von einer Plattform, einem Konzernkonto oder einem Bezahldienst: ein Server, eine Datenbankdatei, ein Betriebssystemdienst. Wer will, betreibt seine eigene Instanz.

## Selbst hosten

Voraussetzung ist Node.js 22 oder neuer.

```bash
git clone https://github.com/gallardoalba/wanderbibliothek.git
cd wanderbibliothek

npm install
npm run dev        # http://localhost:3000
```

Die SQLite-Datenbank legt sich beim ersten Start selbst an, im Entwicklungsmodus mit Demodaten. Für den Betrieb sind mindestens `NEXT_PUBLIC_SITE_URL`, `APP_ENCRYPTION_KEY` und `MAIL_WEBHOOK_URL` nötig; ohne Verschlüsselungsschlüssel wird kein Geheimnis gespeichert. Die vollständige Anleitung mit systemd, nginx, TLS, Sicherungen und Zeitplänen steht in [`deploy/README.md`](deploy/README.md).

Ein Verwaltungskonto entsteht über `ADMIN_EMAIL`/`ADMIN_PASSWORD` oder mit `npm run admin:create`.

## Technische Dokumentation

Architektur, Routen, Datenmodell, Sicherheit, Umgebungsvariablen und Betrieb sind aus diesem README ausgelagert:

- **In der Anwendung selbst** unter `/documentacion` – dieselbe Seite, die die Instanz ausliefert, ohne Konto lesbar.
- **Im Repository**: [`CONTRIBUTING.md`](CONTRIBUTING.md) (Umgebung, Qualitätsbefehle, Commit-Konventionen, Migrationsregeln), [`deploy/README.md`](deploy/README.md) (Betrieb) und [`SECURITY.md`](SECURITY.md) (Meldeweg für Schwachstellen).

Lint, Typprüfung, über 320 automatisierte Tests, Browser-Tests, ein Produktions-Build und ein Image-Build laufen bei jedem Push in der CI; `npm audit --omit=dev` meldet derzeit keine offenen Punkte.

## Mitmachen

Fehlerberichte, Vorschläge und Pull Requests sind willkommen. Ein Blick in [`CONTRIBUTING.md`](CONTRIBUTING.md) lohnt vorher: Dort stehen die Befehle, die eine Änderung erfüllen muss, und die Regel, dass neue Texte in beiden Sprachen dazukommen.

## Sicherheit

Schwachstellen bitte über **Security → Report a vulnerability** im Repository melden (privater Hinweis von GitHub, kein öffentliches Issue). Umfang, Antwortzeiten und Hinweise zum Selbsthosten stehen in [`SECURITY.md`](SECURITY.md).

## Lizenz und Herkunftsnachweise

Der Code steht unter der **MIT-Lizenz** – siehe [`LICENSE`](LICENSE).

Fremde Bestandteile (Titelfoto, Schrift der Cover) behalten ihre eigenen Lizenzen und sind in [`NOTICE`](NOTICE) genannt.
