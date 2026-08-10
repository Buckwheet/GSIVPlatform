import { buildPricingFixture } from "../tests/fixtures/pricing-fixture.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: tsx scripts/make-pricing-fixture.ts <out.db3>");
  process.exit(1);
}
const src = buildPricingFixture();
src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
src.close();
console.log(`pricing fixture written to ${out}`);
