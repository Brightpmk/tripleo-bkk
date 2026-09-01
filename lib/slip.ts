export const MAX_SLIP_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const acceptedSlipMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

export type SlipValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateSlipFile(file: Pick<File, "size" | "type">) {
  if (!acceptedSlipMimeTypes.includes(file.type)) {
    return {
      ok: false,
      message: "ไฟล์ไม่รองรับ กรุณาอัปโหลดรูป JPG, PNG หรือ WEBP"
    } satisfies SlipValidationResult;
  }

  if (file.size > MAX_SLIP_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: "ไฟล์มีขนาดใหญ่เกินไป กรุณาใช้รูปที่ไม่เกิน 5 MB"
    } satisfies SlipValidationResult;
  }

  return { ok: true } satisfies SlipValidationResult;
}
