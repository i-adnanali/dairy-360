// Animal registry -- rebuild command (decision doc §10).
//
//   npm run registry:rebuild -w server
//   npm run registry:rebuild -w server -- --animal=BD-0001
//   npm run registry:rebuild -w server -- --as-of=2026-03-01
//
// Recomputes every projection table from registry_animal_events. Idempotent and
// safe to run at any time -- it is the correct response to a stale projection,
// which is what invariant 1 reports when an animal has aged past the calf
// threshold since the last rebuild.
//
// Follows the repo's CLI convention: hand-parsed `--flag=value` from
// process.argv.slice(2), a USAGE string, and a `require.main === module` guard
// so importing this module runs nothing.

import { db } from '../db';
import { farmToday } from './time';
import { rebuild } from './projectStore';

interface Args {
  animal?: string;
  asOf?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { help: false };
  for (const raw of argv) {
    const [flag, value] = raw.split('=');
    switch (flag) {
      case '--animal':
        args.animal = value;
        break;
      case '--as-of':
        args.asOf = value;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown flag '${raw}'\n\n${USAGE}`);
    }
  }
  return args;
}

const USAGE = `
Usage:
  npm run registry:rebuild -w server [-- --animal=BD-0001] [-- --as-of=YYYY-MM-DD]

  --animal=<serial>   rebuild one animal instead of the whole registry
  --as-of=<date>      farm-local date the status projection is computed as of
                      (default: today in Asia/Karachi). Status depends on the
                      date because an animal is a calf until it is 12 months
                      old, so this is explicit rather than a hidden clock read.
`.trim();

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const asOf = args.asOf ?? farmToday();
  const result = rebuild(db, { asOf, animalId: args.animal });

  console.log(
    `registry:rebuild  as-of=${asOf}${args.animal ? `  animal=${args.animal}` : ''}`,
  );
  console.log(
    `  animals ${result.animals}  lactations ${result.lactations}  ` +
      `parentage ${result.parentage}  statuses ${result.statuses}`,
  );
}

if (require.main === module) main();
