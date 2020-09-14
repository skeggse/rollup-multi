// Set of plugins or individual plugin definitions may vary.
// Output options, paths may vary.

import * as sysPath from 'path';

import { guessMaxArity } from 'guess-function-max-arity';
import { rollup, watch } from 'rollup';

import { tapThen, type } from './utils';
export { version as VERSION } from '../package.json';

function* identify(input, t = type(input)) {
  switch (t) {
    case 'string':
      yield input;
      break;
    case 'array':
      yield* input;
      break;
    case 'object':
      for (const key in input) {
        if (hasOwnProperty.call(input, key)) {
          yield { [key]: input[key] };
        }
      }
      break;
    default:
      throw new TypeError(`unsupported input field: ${t}`);
  }
}

const cacheLoads = (plugins, cache = Object.create(null)) => ({
  plugins: [
    {
      name: 'rollup-plugin-multi-internal-load-cache',
      load: (id) => cache[id],
    },
    ...plugins.map((originalPlugin) => {
      const originalLoad = originalPlugin.load;
      const p = originalLoad
        ? {
            ...originalPlugin,
            load(id) {
              const value = originalLoad.call(this === p ? originalPlugin : this, id);
              if (!value) return value;
              cache[id] = value;
              return tapThen(value, (resolvedValue) => (cache[id] = resolvedValue));
            },
          }
        : originalPlugin;
      return p;
    }),
  ],
  cache,
});

// TODO: support assets
const getChunk = ({ output: outputs }) => outputs.find(({ type }) => type === 'chunk');

function* keys(obj) {
  for (const key in obj) {
    if (hasOwnProperty.call(obj, key)) {
      yield key;
    }
  }
}

function* entries(obj) {
  for (const key in obj) {
    if (hasOwnProperty.call(obj, key)) {
      yield [key, obj[key]];
    }
  }
}

// Truncates the given iterable.
function first(iter, fallback) {
  for (const value of iter) {
    return value;
  }
  return fallback;
}

const getName = (value) =>
  typeof inputValue === 'string' ? sysPath.parse(value).name : first(keys(value));

const interpretInput = (value) =>
  typeof inputValue === 'string' ? [sysPath.parse(value).name, value] : first(entries(value));

// TODO: support different output formats etc per input.
async function* build({ input, plugins, cache: { load: cacheLoad = true } = {}, ...inputOptions }) {
  const inputType = type(input);

  // TODO: detect one target in other ways
  if (inputType === 'string') {
    const name = getName(input);
    yield rollup({
      input,
      plugins: plugins.map((plugin) =>
        typeof plugin === 'function' ? plugin(name, input) : plugin
      ),
      cache: false,
      ...inputOptions,
    }).then(({ cache: next, ...bundle }) => ({
      ...bundle,
      generate: (...options) => bundle.generate(...options).then(getChunk),
      // TODO: write
    }));
    return;
  }

  const pluginVariance = plugins.some((plugin) => typeof plugin === 'function');
  // TODO: exclude well-known plugins like node-resolve?
  // const resolutionMayVary =
  //   pluginVariance ||
  //   multiPlugins.some((plugin) => plugin.resolveId && guessMaxArity(plugin.resolveId) > 1);

  const multiPlugins = cacheLoad ? cacheLoads(plugins).plugins : plugins;

  // Elide modules that vary.
  let cache; /*{
    modules: [],
    plugins: Object.create(null),
  };*/

  for (const inputValue of identify(input, inputType)) {
    const [name, entry] = interpretInput(inputValue),
      start = process.hrtime.bigint();
    const { cache: updatedCache, ...bundle } = await rollup({
      ...inputOptions,
      plugins: pluginVariance
        ? multiPlugins.map((plugin) =>
            // TODO: what do we capture here?
            // how to handle e.g. modules resolved by a plugin in one case and skipped in another?
            // maybe after the last plugin that varies we can jump straight to a cache?
            typeof plugin === 'function' ? plugin(name, inputValue) : plugin
          )
        : multiPlugins,
      input: inputValue,
      cache,
    });
    yield {
      ...bundle,
      name,
      entrypoint: entry,
      generate: (outputOptions) => bundle.generate(outputOptions).then(getChunk),
      write: (outputOptions) => bundle.write(outputOptions).then(getChunk),
      stats: {
        duration: Number((process.hrtime.bigint() - start) / 1000000n),
      },
    };
    cache = updatedCache;
    // for (const module of cache.modules) {
    //   module.resolvedIds = Object.create(null);
    // }
  }
}

export function watchBuild(config) {
  // Need to track which modules are included by which entry points. See watchFiles?
}

export { build as rollup, watchBuild as watch };
