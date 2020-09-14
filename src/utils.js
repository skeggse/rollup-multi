export function type(value) {
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

const then = (value, fn) => (type(value) === 'promise' ? value.then(fn) : fn(value));
export const tapThen = (value, fn) => then(value, (v) => (fn(v), v));

const log = (value) => tapThen(value, console.log);
