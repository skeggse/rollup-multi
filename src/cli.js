import * as sysPath from 'path';

import ms from 'ms';
import loadConfigFile from 'rollup/dist/loadConfigFile';

import { tapThen } from './utils';

import { rollup } from './index';

const asArray = (value) => (Array.isArray(value) ? value : [value]);

const resolvePlainOutputOptions = (options, name) =>
  typeof options === 'function' ? options(name) : options;
const resolveOutputOptions = (options, name) =>
  Array.isArray(options)
    ? options.map((opt) => resolvePlainOutputOptions(opt, name))
    : asArray(resolvePlainOutputOptions(options, name));

const WRITE_WHILE_BUNDLING = true;

loadConfigFile(sysPath.resolve(process.cwd(), 'rollup.config.js'), { format: 'es' }).then(
  async ({ options, warnings }) => {
    if (options.length !== 1) {
      throw new Error('rollup-multi only supports a single configuration entry');
    }

    // "warnings" wraps the default `onwarn` handler passed by the CLI.
    // This prints all warnings up to this point:
    console.log(`We currently have ${warnings.count} warnings`);

    // This prints all deferred warnings
    warnings.flush();

    const optionsObj = options[0];

    const writePromises = [],
      writeCalls = [];

    // options is an array of "inputOptions" objects with an additional "output"
    // property that contains an array of "outputOptions".
    // The following will generate all outputs for all inputs, and write them to disk the same
    // way the CLI does it:
    for await (const bundle of rollup(optionsObj)) {
      const write = () => {
        const start = process.hrtime.bigint();
        return resolveOutputOptions(optionsObj.output, bundle.name).map((outputOptions) =>
          tapThen(bundle.write(outputOptions), () => {
            const out = outputOptions.dir || outputOptions.file,
              elapsed = Number((process.hrtime.bigint() - start) / 1000000n);
            console.log();
            console.log(`\x1b[1;36m${bundle.entrypoint} → ${out}...\x1b[m`);
            // TODO: log warnings in here, if any.
            console.log(
              `\x1b[0;32mbundled in \x1b[1m${ms(
                bundle.stats.duration
              )}\x1b[0;32m, created \x1b[1m${out}\x1b[0;32m in \x1b[1m${ms(elapsed)}\x1b[m`
            );
            // console.log(`\x1b[0;32m`);
          })
        );
      };

      if (WRITE_WHILE_BUNDLING) {
        const promise = Promise.all(write());
        promise.catch(() => {});
        writePromises.push(promise);
      } else {
        writeCalls.push(write);
      }
    }
    await Promise.all([...writePromises, ...writeCalls.map((c) => c()).flat()]);

    // You can also pass this directly to "rollup.watch"
    // rollup.watch(options);
  }
);
