import { buildInvFixture } from "../tests/fixtures/inv-fixture.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: tsx scripts/make-smoke-fixture.ts <out.db3>");
  process.exit(1);
}
const src = buildInvFixture();
src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
src.close();
console.log(`fixture written to ${out}`);
