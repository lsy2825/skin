// Worker entry (the module wrangler deploys). The runtime accepts only handlers as exports of this file, so the code
// lives in src/worker.js (also imported by the node tests with their own env) and only the handler object is re-exported.
export { default } from "./worker.js";
