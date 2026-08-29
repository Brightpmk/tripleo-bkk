import {
  acceptedSlipMimeTypes,
  MAX_SLIP_FILE_SIZE_BYTES
} from "@/lib/slip";

export type ValidatedPaymentSlip = {
  buffer: Buffer;
  mimeType: (typeof acceptedSlipMimeTypes)[number];
  extension: "jpg" | "png" | "webp";
};

export type PaymentSlipValidationResult =
  | { ok: true; slip: ValidatedPaymentSlip }
  | { ok: false; message: string };

export async function validatePaymentSlipUpload(
  file: File | null
): Promise<PaymentSlipValidationResult> {
  if (!file) {
    return { ok: false, message: "Payment slip is required." };
  }

  if (file.size <= 0) {
    return { ok: false, message: "Payment slip image is empty." };
  }

  if (file.size > MAX_SLIP_FILE_SIZE_BYTES) {
    return { ok: false, message: "The slip image must be 5 MB or smaller." };
  }

  if (!acceptedSlipMimeTypes.includes(file.type)) {
    return { ok: false, message: "Upload a JPG, PNG, or WEBP image." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectImageType(buffer);

  if (!detected || detected.mimeType !== file.type) {
    return { ok: false, message: "The selected slip image could not be verified." };
  }

  return {
    ok: true,
    slip: {
      buffer,
      mimeType: detected.mimeType,
      extension: detected.extension
    }
  };
}

export function detectImageType(
  buffer: Buffer
): Pick<ValidatedPaymentSlip, "mimeType" | "extension"> | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  return null;
}
