"use client";

import Link from "next/link";
import { couponRecipientHref, stageCouponRecipient } from "../../coupons/coupon-recipient-handoff";

export default function CouponRecipientLink({ memberCode }: { memberCode: string }) {
  return <Link className="underline" href={couponRecipientHref} prefetch={false}
    onNavigate={() => stageCouponRecipient(memberCode)}>ไปที่หน้ามอบหมายคูปอง</Link>;
}
