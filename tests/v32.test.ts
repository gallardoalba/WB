import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.WANDERBIBLIOTHEK_DB = ":memory:";

type DbModule = typeof import("../src/lib/db/index.ts");
type RepoModule = typeof import("../src/lib/repo.ts");

let dbModule: DbModule;
let repo: RepoModule;

before(async () => {
  dbModule = await import("../src/lib/db/index.ts");
  repo = await import("../src/lib/repo.ts");
});

const isStatus = (status: number) => (error: unknown) =>
  error instanceof Error && "status" in error && (error as { status: number }).status === status;

test("una denuncia solo se resuelve una vez", () => {
  repo.reportContent({
    reporterId: "usr_ana",
    targetType: "listing",
    targetId: "lst_2",
    reason: "Spam o publicidad",
    details: "Prueba de la auditoría.",
  });
  const [report] = repo.listReports({ limit: 1, offset: 0 });
  assert.ok(report, "se acaba de crear la denuncia");

  repo.resolveReport("usr_admin", report!.id, "dismiss");
  assert.throws(
    () => repo.resolveReport("usr_admin", report!.id, "dismiss"),
    isStatus(409),
  );
});

test("las listas de administración paginan y sus contadores cuadran", () => {
  const db = dbModule.getDb();
  const insertAudit = db.prepare(
    `INSERT INTO admin_audit (id, admin_id, action, target_type, target_id, details, created_at)
     VALUES (?, 'usr_admin', 'dismiss', 'listing', ?, '', ?)`,
  );
  const auditBefore = repo.countAudit();
  for (let index = 0; index < 7; index += 1) {
    insertAudit.run(`aud_test_${index}`, `lst_${index}`, new Date(Date.now() - index * 1000).toISOString());
  }
  assert.equal(repo.countAudit(), auditBefore + 7);
  const firstPage = repo.listAudit(3, 0).map((entry) => entry.id);
  const secondPage = repo.listAudit(3, 3).map((entry) => entry.id);
  assert.equal(firstPage.length, 3);
  assert.equal(secondPage.length, 3);
  assert.equal(firstPage.some((id) => secondPage.includes(id)), false);

  const insertComment = db.prepare(
    `INSERT INTO book_comments (id, book_id, author_id, parent_id, body, spoiler, status, created_at)
     VALUES (?, 'bok_1', 'usr_ana', NULL, 'texto', 0, 'hidden', ?)`,
  );
  const commentsBefore = repo.countHiddenComments();
  for (let index = 0; index < 3; index += 1) {
    insertComment.run(`cmt_hidden_${index}`, new Date(Date.now() - index * 1000).toISOString());
  }
  assert.equal(repo.countHiddenComments(), commentsBefore + 3);
  assert.deepEqual(
    repo.listHiddenComments(2, commentsBefore).map((comment) => comment.id),
    ["cmt_hidden_0", "cmt_hidden_1"],
  );
  assert.equal(repo.listHiddenComments(2, 2).length, 1);
});
