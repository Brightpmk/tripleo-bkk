import type { CheckoutDetails, PaymentStatus } from "./orders";
import type { UniversityId } from "./catalog";

export type OrderSubmissionItemInput = {
  productId: string;
  size: string;
  quantity: number;
  displayedUnitPriceThb?: number;
};

export type OrderSubmissionRequest = {
  universityId: UniversityId;
  checkout: CheckoutDetails;
  items: OrderSubmissionItemInput[];
  slipSelected: boolean;
  submissionKey: string;
};

export type OrderSubmissionSuccess = {
  ok: true;
  order: {
    orderId: string;
    createdAtIso: string;
    universityId: UniversityId;
    itemSubtotalThb: number;
    shippingFeeThb: number;
    finalTotalThb: number;
    paymentStatus: PaymentStatus;
  };
};

export type OrderSubmissionFailure = {
  ok: false;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type OrderSubmissionResult =
  | OrderSubmissionSuccess
  | OrderSubmissionFailure;
