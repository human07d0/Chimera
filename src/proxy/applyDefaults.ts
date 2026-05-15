/**
 * Applies model-level default parameters to the transformed body.
 * Only applies defaults for keys the client did NOT provide.
 * Uses shallow, top-level key match only.
 * Default keys use transformed field names (i.e., the names expected by the upstream API after transformation).
 */
export function applyDefaults(
  body: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined,
  originalClientBody: Record<string, unknown>,
): Record<string, unknown> {
  if (!defaults) return body;

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in originalClientBody)) {
      body[key] = value;
    }
  }

  return body;
}
