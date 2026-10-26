// Only API-generated image paths may be used as relative image sources.
// Arbitrary relative paths, queries, fragments and protocol-relative URLs are
// deliberately excluded; this is also used by the separately built admin.
const hostedImagePattern = /^\/api\/v1\/media\/images\/(media_[a-f0-9]{32})$/;

export function hostedImageId(value: string) {
  return hostedImagePattern.exec(value)?.[1] ?? '';
}
