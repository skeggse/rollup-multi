import { minify } from 'terser';

import { rollup } from '.';

const exampleConfig = (name, main) => [
  {
    input: name,
    plugins: [
      {
        resolveId: (id) => id,
        load: () => main,
      },
    ],
  },
  {
    format: 'es',
    sourcemap: false,
  },
];

const result = (value) => (typeof value === 'function' ? value() : value);

function virtual(...files) {
  const names = Object.assign(
    Object.create(null),
    Object.fromEntries(files.map(({ name, content }) => [name, { content }]))
  );
  return {
    resolveId: (id) => (names[id] ? id : undefined),
    load: (id) => result(names[id]?.content),
  };
}

const mini_ = (code, map) =>
  minify(code, { mangle: false, toplevel: true, sourceMap: map ? { content: map } : false });

const miniOptions = ({ code, map: originalMap, ...rest }) =>
  mini_(code, originalMap).then(({ code, map }) => ({
    ...rest,
    code,
    ...(originalMap && { map }),
  }));

const mini = (v) =>
  typeof v === 'string'
    ? mini_(v).then(({ code }) => code)
    : Array.isArray(v)
    ? Promise.all(v.map(mini))
    : miniOptions(v);

const tap = (fn) => (v) => (fn(v), v);
const log = tap(console.log);

describe('rollup', () => {
  it('should bundle one entrypoint', async () => {
    const main = 'export default 1;';
    const [input, output] = exampleConfig('main', main);
    await expect(
      rollup(input)
        .then((bundle) => bundle.generate(output))
        .then(mini)
    ).resolves.toMatchObject(
      await mini({
        name: 'main',
        code: main,
      })
    );
  });

  it('should bundle an array of entrypoints', async () => {
    await expect(
      rollup({
        input: ['a', 'b'],
        plugins: [
          virtual(
            { name: 'a', content: "export {a as default,g} from 'c';" },
            { name: 'b', content: "export {b as default,g} from 'c';" },
            { name: 'c', content: 'export const a=1;export const b=2;export const g=Math.random' }
          ),
        ],
      })
        .then((bundle) => bundle.generate({ format: 'es', sourcemap: false }))
        .then(mini)
    ).resolves.toEqual(
      await mini([
        { code: 'const g=Math.random;export default 1;export{g}' },
        { code: 'const g=Math.random;export default 2;export{g}' },
      ]).then((items) => items.map(expect.objectContaining))
    );
  });

  it('should cache loaded content', async () => {
    const r = Math.random(),
      content = jest.fn(() => `export const a=1;export const b=2;export const r=${r}`);
    await expect(
      rollup({
        input: ['a', 'b'],
        plugins: [
          virtual(
            { name: 'a', content: "export {a as default,r} from 'c';" },
            { name: 'b', content: "export {b as default,r} from 'c';" },
            { name: 'c', content }
          ),
        ],
      })
        .then((bundle) => bundle.generate({ format: 'es', sourcemap: false }))
        .then(mini)
    ).resolves.toEqual(
      await mini([
        { code: `const r=${r};export default 1;export{r}` },
        { code: `const r=${r};export default 2;export{r}` },
      ]).then((items) => items.map(expect.objectContaining))
    );

    expect(content).toHaveBeenCalledTimes(1);
  });

  it('should cache transformed content', async () => {
    const r = Math.random(),
      transform = jest.fn((code, id) => (id === 'c' ? code.replace('REPLACEME', r) : undefined));
    await expect(
      rollup({
        input: ['a', 'b'],
        plugins: [
          virtual(
            { name: 'a', content: "export {a as default,r} from 'c';" },
            { name: 'b', content: "export {b as default,r} from 'c';" },
            { name: 'c', content: 'export const a=1;export const b=2;export const r=REPLACEME' }
          ),
          {
            transform,
          },
        ],
      })
        .then((bundle) => bundle.generate({ format: 'es', sourcemap: false }))
        .then(mini)
    ).resolves.toEqual(
      await mini([
        { code: `const r=${r};export default 1;export{r}` },
        { code: `const r=${r};export default 2;export{r}` },
      ]).then((items) => items.map(expect.objectContaining))
    );

    expect(transform).toHaveBeenCalledTimes(3);
  });

  it.only('should allow variance by id resolution', async () => {
    const r_c = Math.random(),
      r_d = Math.random(),
      transform = jest.fn((code, id) =>
        ['c', 'd'].includes(id) ? code.replace('REPLACEME', id === 'c' ? r_c : r_d) : undefined
      );
    await expect(
      rollup({
        input: ['a', 'b'],
        plugins: [
          {
            resolveId: (id, importer) => (importer === 'a' && id === 'c' ? 'c' : 'd'),
          },
          virtual(
            { name: 'a', content: "export {a as default,r} from 'c';" },
            { name: 'b', content: "export {b as default,r} from 'c';" },
            { name: 'c', content: 'export const a=1;export const b=2;export const r=REPLACEME' },
            // replaces 'c' for 'b'
            { name: 'd', content: 'export const b=2;export const r=REPLACEME' }
          ),
          {
            transform,
          },
        ],
      })
        .then((bundle) => bundle.generate({ format: 'es', sourcemap: false }))
        .then(mini)
    ).resolves.toEqual(
      await mini([
        { code: `const r=${r_c};export default 1;export{r}` },
        { code: `const r=${r_d};export default 2;export{r}` },
      ]).then((items) => items.map(expect.objectContaining))
    );

    expect(transform).toHaveBeenCalledTimes(4);
  });
});
