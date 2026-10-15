// Worker entry (wrangler.jsonc "main"). Only a default export here: workerd treats every named export of this module as an
// entrypoint and refuses strings or helpers. Logic and tests: src/handler.js, src/rules.js, cf/metrics/test/.
import { createHandler } from "./handler.js";

export default createHandler();
