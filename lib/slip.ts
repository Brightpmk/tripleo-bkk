export const MAX_SLIP_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const acceptedSlipMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic"
];

export type SlipValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateSlipFile(file: Pick<File, "size" | "type">) {
  if (!acceptedSlipMimeTypes.includes(file.type)) {
    return {
      ok: false,
      message: "Upload a JPG, PNG, WEBP, or HEIC image."
    } satisfies SlipValidationResult;
  }

  if (file.size > MAX_SLIP_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: "The slip image must be 5 MB or smaller."
    } satisfies SlipValidationResult;
  }

  return { ok: true } satisfies SlipValidationResult;
}
