/**
 * Windows ESM loader hook: jiti emits bare Windows absolute paths (D:/...)
 * to the ESM loader, which rejects anything without a file:// scheme.
 * This hook transparently converts them to file:// URLs.
 */
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    return nextResolve(pathToFileURL(specifier).href, context);
  }
  return nextResolve(specifier, context);
}
