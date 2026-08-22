import { spawnSync } from "node:child_process";

const suites = [
  "tests/organizer-auth-acceptance.test.mjs",
  "tests/supabase-acceptance.test.mjs",
  "tests/sprint2-acceptance.test.mjs",
  "tests/sprint3-acceptance.test.mjs",
  "tests/sprint4-acceptance.test.mjs",
];

let failed = false;
for (const suite of suites) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", suite], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
