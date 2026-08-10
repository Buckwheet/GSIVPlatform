import { ConfigFiles } from "./src/core/config-files.js";

const cf = new ConfigFiles({ gsivDir: "/tmp/gsiv-config/GSIV", gstDir: "/tmp/gsiv-config/GST" });
// @ts-expect-error - private for the debug
const dir = cf.resolveCharDir("neleourg", undefined);
console.log("resolveCharDir(neleourg):", JSON.stringify(dir));
// @ts-expect-error
console.log("resolveCharDir(fisternar):", JSON.stringify(cf.resolveCharDir("fisternar")));

import { existsSync } from "node:fs";
import { join } from "node:path";

console.log("gst/neleourg exists:", existsSync(join("/tmp/gsiv-config/GST", "neleourg")));
