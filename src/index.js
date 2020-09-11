// Set of plugins or individual plugin definitions may vary.
// Output options, paths may vary.

import * as sysPath from 'path';

import { guessMaxArity } from 'guess-function-max-arity';
import { rollup, watch } from 'rollup';

export { version as VERSION } from '../package.json';

function type(value) {
  const t = typeof value;
  switch (t) {
    case 'string':
    case 'boolean':
    case 'undefined':
    case 'number':
    case 'bigint':
    case 'symbol':
    case 'function':
      return t;
    default:
      throw new Error('unknown type');
    case 'object':
  }

  switch (toString.call(value)) {
    case '[object Null]':
      return 'null';
    case '[object Date]':
      return 'date';
    case '[object Array]':
      return 'array';
    case '[object Error]':
      return 'error';
    case '[object Promise]':
      return 'promise';
  }
  return 'object';
}

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

const then = (value, fn) => (type(value) === 'promise' ? value.then(fn) : fn(value));
const tapThen = (value, fn) => then(value, (v) => (fn(v), v));

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

function firstKey(obj) {
  for (const key in obj) {
    if (hasOwnProperty.call(obj, key)) {
      return key;
    }
  }
}

async function build({ input, plugins, cache: { load: cacheLoad = true } = {}, ...inputOptions }) {
  const inputType = type(input);

  if (inputType === 'string') {
    return rollup({ input, ...inputOptions }).then(({ cache: next, ...bundle }) => ({
      ...bundle,
      generate: (...options) => bundle.generate(...options).then(getChunk),
      // TODO: write
    }));
  }

  const multiPlugins = cacheLoad ? cacheLoads(plugins).plugins : plugins;

  const pluginVariance = multiPlugins.some((plugin) => typeof plugin === 'function');
  const resolutionMayVary =
    pluginVariance ||
    multiPlugins.some((plugin) => plugin.resolveId && guessMaxArity(plugin.resolveId) > 1);

  // Elide modules that vary.
  let cache; /*{
    modules: [],
    plugins: Object.create(null),
  };*/

  const bundles = [];
  for (const inputValue of identify(input, inputType)) {
    const inputName =
      typeof inputValue === 'string' ? sysPath.parse(inputValue).name : firstKey(inputValue);
    const { cache: updatedCache, ...bundle } = await rollup({
      ...inputOptions,
      plugins: pluginVariance
        ? multiPlugins.map((plugin) =>
            // TODO: what do we capture here?
            // how to handle e.g. modules resolved by a plugin in one case and skipped in another?
            // maybe after the last plugin that varies we can jump straight to a cache?
            typeof plugin === 'function' ? plugin(inputName, inputValue) : plugin
          )
        : multiPlugins,
      input: inputValue,
      cache,
    });
    bundles[bundles.length] = bundle;
    cache = updatedCache;
  }

  return {
    // TODO: perf?
    async generate(outputOptions) {
      const results = await Promise.all(
        bundles.map((bundle) => bundle.generate(outputOptions).then(getChunk))
      );
      return inputType === 'array'
        ? results
        : Object.fromEntries(results.map((result, i) => [input[i], result]));
    },
  };
}

export function watchBuild(config) {
  // Need to track which modules are included by which entry points.
}

export { build as rollup, watchBuild as watch };
