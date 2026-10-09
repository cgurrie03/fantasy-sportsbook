import { inflateSync } from "node:zlib";
// Only server-validated, raster PNGs are stored. Re-encoding in the client is a
// convenience; this validator independently checks chunks, CRC, dimensions and
// decompressed scanline layout. HTML/SVG and trailing executable content fail.
export function validatePng(base64: unknown) {
  if (
    typeof base64 !== "string" ||
    base64.length > 4 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw Error("Invalid image data.");
  const b = Buffer.from(base64, "base64");
  if (
    b.toString("base64") !== base64 ||
    !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error("Upload a raster PNG image.");
  let p = 8,
    width = 0,
    height = 0,
    color = 0,
    ended = false;
  const data: Buffer[] = [];
  while (p < b.length) {
    if (p + 12 > b.length) throw Error("Incomplete PNG.");
    const n = b.readUInt32BE(p),
      type = b.toString("ascii", p + 4, p + 8);
    if (n > b.length - p - 12) throw Error("Invalid PNG chunk.");
    const body = b.subarray(p + 8, p + 8 + n);
    let crc = 0xffffffff;
    for (const byte of b.subarray(p + 4, p + 8 + n)) {
      crc ^= byte;
      for (let k = 0; k < 8; k++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== b.readUInt32BE(p + 8 + n))
      throw Error("Image checksum failed.");
    if (p === 8 && type !== "IHDR") throw Error("Missing PNG header.");
    if (type === "IHDR") {
      if (width || n !== 13) throw Error("Invalid PNG header.");
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      color = body[9];
      if (
        width !== 1200 ||
        height !== 522 ||
        body[8] !== 8 ||
        ![2, 6].includes(color) ||
        body[10] !== 0 ||
        body[11] !== 0 ||
        body[12] !== 0
      )
        throw Error("Use the landscape image editor before uploading.");
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") {
      if (n !== 0 || p + 12 !== b.length) throw Error("Invalid PNG ending.");
      ended = true;
    } else if (!["sRGB", "gAMA", "pHYs", "cHRM"].includes(type))
      throw Error("Unsupported PNG metadata.");
    p += n + 12;
  }
  if (!ended || !data.length) throw Error("Incomplete image.");
  const row = 1 + width * (color === 6 ? 4 : 3),
    pixels = inflateSync(Buffer.concat(data), {
      maxOutputLength: row * height,
    });
  if (pixels.length !== row * height) throw Error("Invalid image pixels.");
  for (let y = 0; y < height; y++)
    if (pixels[y * row] > 4) throw Error("Invalid PNG filter.");
  return base64;
}
