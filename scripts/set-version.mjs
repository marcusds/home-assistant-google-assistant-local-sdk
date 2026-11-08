// Replace the __VERSION__ placeholder in the built app.js with the
// version from package.json.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const built = readFileSync("app.js", "utf8");
if (!built.includes("__VERSION__")) {
  throw new Error("__VERSION__ placeholder not found in app.js");
}
writeFileSync("app.js", built.replaceAll("__VERSION__", version));
console.log(`app.js version set to ${version}`);
