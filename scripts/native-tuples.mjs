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
