// Supported native Node addon platforms and the files each package must contain.
import { readFileSync } from 'node:fs';

export const NATIVE_TUPLES = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-gnu',
  'linux-x64-gnu',
  'win32-arm64-msvc',
  'win32-x64-msvc',
]);

export function nativeArtifactNames(tuple) {
  const files = [`postcss-go.${tuple}.node`];
  if (tuple.startsWith('win32-')) files.push('libpostcssgo.dll');
  return files;
}

function isMuslLinux() {
  try {
    return readFileSync('/usr/bin/ldd', 'utf8').includes('musl');
  } catch {
    return !process.report?.getReport()?.header?.glibcVersionRuntime;
  }
}

/** Host platform tuple matching npm/postcss-go/<tuple> packages. */
export function currentNativeTuple() {
  let tuple;
  if (process.platform === 'darwin') tuple = `darwin-${process.arch}`;
  else if (process.platform === 'win32') tuple = `win32-${process.arch}-msvc`;
  else if (process.platform === 'linux') {
    if (isMuslLinux()) {
      throw new Error(
        'postcss-go: native Node addons are unavailable on musl until Go fixes golang/go#54805',
      );
    }
    tuple = `linux-${process.arch}-gnu`;
  } else {
    throw new Error(`unsupported native platform ${process.platform}-${process.arch}`);
  }
  if (!NATIVE_TUPLES.includes(tuple)) {
    throw new Error(`unsupported native platform ${tuple}`);
  }
  return tuple;
}

export function currentNativePackageName() {
  return `@postcss-go/native-${currentNativeTuple()}`;
}
