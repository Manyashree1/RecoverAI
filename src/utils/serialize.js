/**
 * Converts a Mongoose lean document (or plain object) into a client-facing
 * shape: `_id` becomes `id`, `__v` is dropped, and ObjectId-typed fields are
 * stringified. This keeps Mongoose/MongoDB internals out of API responses.
 */
function toPublicJSON(doc) {
  if (doc === null || doc === undefined) return doc;
  const source = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return stringifyIds({ ...source, id: idToString(source._id), _id: undefined, __v: undefined });
}

function stringifyIds(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (isObjectIdLike(value)) result[key] = idToString(value);
    else if (isPopulatedSubdocument(value)) result[key] = toPublicJSON(value);
    else if (Array.isArray(value)) result[key] = value.map((item) => (isPopulatedSubdocument(item) ? toPublicJSON(item) : item));
    else result[key] = value;
  }
  return result;
}

function isPopulatedSubdocument(value) {
  return Boolean(value) && typeof value === 'object' && !isObjectIdLike(value) && !(value instanceof Date) && '_id' in value;
}

function isObjectIdLike(value) {
  return value && typeof value === 'object' && typeof value.toHexString === 'function';
}

function idToString(value) {
  if (value === undefined || value === null) return value;
  return isObjectIdLike(value) ? value.toHexString() : String(value);
}

module.exports = { toPublicJSON };
